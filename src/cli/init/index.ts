import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';
import { setActiveWorkspace } from '../../workspace/active-workspace.js';
import { hubDir, hubConfigPath, loadHubConfig, resetHubConfigCache } from '../../workspace/hub-config.js';
import { NodePlatformProbe } from '../../adapters/platform/index.js';
import { CliDockerControl } from '../../adapters/docker/index.js';
import { HttpOllamaControl } from '../../adapters/ollama/index.js';
import { CheckVersionsUseCase } from '../../use-cases/init/check-versions.js';
import { CheckHubExistsUseCase } from '../../use-cases/init/check-hub-exists.js';
import { WaitForDockerUseCase } from '../../use-cases/init/wait-for-docker.js';
import { ResolveHubPortsUseCase, labelForPortKey, type HubPorts, type PortPlanEntry } from '../../use-cases/init/resolve-hub-ports.js';
import { BootstrapHubUseCase } from '../../use-cases/init/bootstrap-hub.js';
import { ClearStaleActiveUseCase } from '../../use-cases/init/clear-stale-active.js';
import { ValidateWorkspaceNameUseCase } from '../../use-cases/init/validate-workspace-name.js';
import { InstallOllamaUseCase } from '../../use-cases/init/install-ollama.js';
import { EnsureOllamaRunningUseCase } from '../../use-cases/init/ensure-ollama-running.js';
import { EnsureEmbeddingModelUseCase } from '../../use-cases/init/ensure-embedding-model.js';
import { ProbeLlmUseCase } from '../../use-cases/init/probe-llm.js';
import { HealthCheckExistingLlmUseCase } from '../../use-cases/init/health-check-existing-llm.js';
import { WriteConfigEnvUseCase } from '../../use-cases/init/write-config-env.js';
import { CheckDimsConflictUseCase } from '../../use-cases/init/check-dims-conflict.js';
import type { LlmSetupPlan } from '../../core/types/init.js';
import type { InitFlags } from './types.js';
import {
  promptConfigureCode,
  promptDimsRecreate,
  promptOwnLlm,
  promptOwnLlmUrlAndModel,
  promptPortChoice,
  promptProbeRetry,
  promptWaitForDocker,
  promptWorkspaceName,
  promptReconfigureBrokenLlm,
} from './prompts.js';
import {
  printDockerNotRunning,
  printDockerTimeout,
  printDone,
  printHeader,
  printLlmHealthyAtReinit,
  printNoInteractiveMissingName,
  printOllamaInstallFailed,
  printOllamaTimeout,
  printOllamaWindowsLink,
  printPortPlan,
  printPortsAborted,
  printProbeError,
  printPullFailed,
  printSwitchedTo,
  printVersionFailure,
  printWorkspaceList,
  printWriteConfigFailed,
  printBootstrapFailure,
  printStaleActiveCleared,
} from './presenter.js';

export type { InitFlags } from './types.js';

const HUB_PORT_DEFAULTS = {
  pg: 15432,
  pgweb: 15433,
  neo4jHttp: 15434,
  neo4jBolt: 15435,
  qdrantRest: 15436,
  qdrantGrpc: 15437,
} as const;
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';
const MAX_PROBE_ATTEMPTS = 3;

function getTemplatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'templates');
}

interface HubStoreFactory {
  open(): Promise<{ store: IWorkspaceStore; close: () => Promise<void> }>;
}

function makeHubStoreFactory(): HubStoreFactory {
  return {
    async open() {
      const { loadHubConfig: load } = await import('../../workspace/hub-config.js');
      const { PostgresWorkspaceStore, createPool } = await import('../../adapters/postgres/index.js');
      const hub = load();
      const pool = createPool(hub.db);
      const store = new PostgresWorkspaceStore(pool);
      return { store, close: async (): Promise<void> => { await pool.end(); } };
    },
  };
}

export async function runInit(flags: InitFlags = {}): Promise<void> {
  printHeader();

  const platform = new NodePlatformProbe();
  const docker = new CliDockerControl(platform);
  const ollama = new HttpOllamaControl(platform);

  const versions = new CheckVersionsUseCase(platform, docker);
  const v = await versions.execute();
  if (!v.ok) {
    printVersionFailure(v.failure);
    process.exit(1);
  }

  if (!await docker.isRunning()) {
    if (flags.interactive === false) {
      printDockerNotRunning();
      process.exit(1);
    }
    printDockerNotRunning();
    const wait = await promptWaitForDocker();
    if (!wait) {
      process.exit(0);
    }
    const spinner = ora('Waiting for Docker').start();
    const came = await new WaitForDockerUseCase(docker).execute({
      onTick: (sec) => { spinner.text = `Waiting for Docker (${String(sec)}s)`; },
    });
    spinner.stop();
    if (!came) {
      printDockerTimeout();
      process.exit(1);
    }
  }

  const hubStoreFactory = makeHubStoreFactory();

  let hubExists: boolean;
  try {
    const tmp = await hubStoreFactory.open();
    try {
      const c = await new CheckHubExistsUseCase(hubDir(), tmp.store).execute();
      hubExists = c.exists;
    } finally {
      await tmp.close();
    }
  } catch {
    hubExists = false;
  }

  let activePorts: HubPorts;
  if (!hubExists) {
    const portsResult = await resolvePorts(platform, flags);
    if (portsResult == null) {
      printPortsAborted();
      process.exit(1);
    }
    activePorts = portsResult;

    const bootstrapSpinner = ora('Bootstrap hub').start();
    const bootstrapResult = await bootstrap(hubStoreFactory, flags, activePorts, (msg) => { bootstrapSpinner.text = msg; });
    bootstrapSpinner.stop();
    if (!bootstrapResult.ok) {
      printBootstrapFailure(bootstrapResult.stage, bootstrapResult.details);
      process.exit(1);
    }
    console.log(chalk.green('  ✓ hub bootstrapped'));
  } else {
    console.log(chalk.dim('  Hub already exists, skipping bootstrap.'));
    activePorts = readPortsFromConfig();
  }

  resetHubConfigCache();

  const { store: hubStore, close: closeHub } = await hubStoreFactory.open();
  try {
    if (hubExists) {
      const stale = await new ClearStaleActiveUseCase(hubStore).execute();
      if (stale.cleared) {
        printStaleActiveCleared(stale.staleId);
      }
    }

    const existingList = (await hubStore.list()).map((w) => w.name);
    printWorkspaceList(existingList);

    if (flags.interactive === false && (flags.name === undefined || flags.name === '')) {
      printNoInteractiveMissingName();
      process.exit(1);
    }

    const validator = new ValidateWorkspaceNameUseCase(hubStore);
    let workspaceId = '';
    let workspaceName = '';
    let nameHint = flags.name;
    while (workspaceId.length === 0) {
      const raw = nameHint ?? await promptWorkspaceName(existingList);
      const v2 = await validator.execute(raw);
      if (!v2.ok) {
        if (flags.interactive === false) {
          printNoInteractiveMissingName();
          process.exit(1);
        }
        nameHint = undefined;
        continue;
      }
      if (v2.action === 'create') {
        await hubStore.create({ id: v2.id, name: v2.name });
        console.log(chalk.green(`  ✓ workspace "${v2.name}" created`));
      } else {
        printSwitchedTo(v2.name);
      }
      setActiveWorkspace(v2.id, v2.name);
      await hubStore.touchActive(v2.id);
      workspaceId = v2.id;
      workspaceName = v2.name;
    }

    if (flags.skipLlm === true) {
      writeNoLlm(activePorts);
      printDone(workspaceName, false);
      return;
    }

    const probe = new ProbeLlmUseCase(ollama);
    if (hubExists) {
      try {
        const hub = loadHubConfig();
        const health = await new HealthCheckExistingLlmUseCase(probe).execute(hub);
        if (health.configured) {
          if (health.healthy) {
            printLlmHealthyAtReinit(hub.embedding.model);
            printDone(workspaceName, true);
            return;
          }
          const reconf = flags.interactive === false ? false : await promptReconfigureBrokenLlm();
          if (!reconf) {
            printDone(workspaceName, true);
            return;
          }
        }
      } catch {
        /* config missing — fall through to setup */
      }
    }

    if (flags.interactive !== false) {
      const wantsCode = await promptConfigureCode();
      if (!wantsCode) {
        writeNoLlm(activePorts);
        printDone(workspaceName, false);
        return;
      }
    }

    const plan = await setupLlm(flags, platform, ollama, probe);
    if (plan == null) {
      writeNoLlm(activePorts);
      printDone(workspaceName, false);
      return;
    }

    const dimsOk = await handleDimsConflict(workspaceId, plan.dimensions, flags);
    if (!dimsOk) {
      writeNoLlm(activePorts);
      printDone(workspaceName, false);
      return;
    }

    const writeRes = new WriteConfigEnvUseCase().execute({
      llm: plan,
      ports: activePorts,
      targetPath: hubConfigPath(),
    });
    if (!writeRes.ok) {
      printWriteConfigFailed(writeRes.details);
      process.exit(1);
    }
    resetHubConfigCache();
    printDone(workspaceName, true);
  } finally {
    await closeHub();
  }
}

function readPortsFromConfig(): HubPorts {
  try {
    const hub = loadHubConfig();
    const qdrantPortStr = new URL(hub.qdrant.url).port;
    const qdrantPort = Number(qdrantPortStr !== '' ? qdrantPortStr : '15436');
    const neo4jPortStr = new URL(hub.neo4j.uri.replace('bolt://', 'http://')).port;
    const neo4jBoltPort = Number(neo4jPortStr !== '' ? neo4jPortStr : '15435');
    return {
      pg: hub.db.port,
      pgweb: HUB_PORT_DEFAULTS.pgweb,
      neo4jBolt: neo4jBoltPort,
      neo4jHttp: HUB_PORT_DEFAULTS.neo4jHttp,
      qdrantRest: qdrantPort,
      qdrantGrpc: HUB_PORT_DEFAULTS.qdrantGrpc,
    };
  } catch {
    return { ...HUB_PORT_DEFAULTS };
  }
}

async function handleDimsConflict(
  workspaceId: string,
  newDims: number,
  flags: InitFlags,
): Promise<boolean> {
  const { QdrantCodeVectorStore } = await import('../../adapters/qdrant/index.js');
  const hub = loadHubConfig();
  const vec = new QdrantCodeVectorStore({ url: hub.qdrant.url });
  try {
    const conflict = await new CheckDimsConflictUseCase(vec).execute(workspaceId, newDims);
    if (!conflict.conflict) {
      return true;
    }
    console.log(
      chalk.yellow(
        `  ⚠ Embedding dimensions changed: ${String(conflict.existingDims)} → ${String(conflict.newDims)}. ` +
          `Qdrant collection "${conflict.vectorCollection}" must be deleted.`,
      ),
    );
    const recreate = flags.interactive === false
      ? false
      : await promptDimsRecreate(conflict.existingDims, conflict.newDims);
    if (!recreate) {
      console.log(chalk.dim('  Skipped — keeping existing collection. LLM provider NOT saved.'));
      return false;
    }
    const spinner = ora(`Deleting Qdrant collection ${conflict.vectorCollection}`).start();
    try {
      await vec.deleteCollection(workspaceId);
      spinner.succeed(`Deleted ${conflict.vectorCollection}`);
    } catch (err) {
      spinner.fail(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Could not check Qdrant collection dims: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.dim('  Continuing — first `argustack code index` will create the collection fresh.'));
    return true;
  } finally {
    await vec.close();
  }
}

async function resolvePorts(platform: NodePlatformProbe, flags: InitFlags): Promise<HubPorts | null> {
  const resolver = new ResolveHubPortsUseCase(platform);
  const { plan } = await resolver.execute({ ...HUB_PORT_DEFAULTS });

  const finalPorts: HubPorts = { ...HUB_PORT_DEFAULTS };
  for (const entry of plan) {
    if (entry.conflict == null) {
      finalPorts[entry.key] = entry.current;
      continue;
    }
    if (flags.interactive === false) {
      if (entry.suggested === null) {
        return null;
      }
      finalPorts[entry.key] = entry.suggested;
      continue;
    }
    const label = labelForPortKey(entry.key);
    const conflictDetails = `${entry.conflict.processName} pid ${String(entry.conflict.pid)}`;
    const decision = await promptPortChoice(label, entry.default, conflictDetails, entry.suggested);
    if (decision.choice === 'abort') {
      return null;
    }
    if (decision.choice === 'accept-suggested' && entry.suggested !== null) {
      finalPorts[entry.key] = entry.suggested;
      continue;
    }
    if (decision.choice === 'custom') {
      finalPorts[entry.key] = decision.port;
    }
  }

  printPortPlan(plan.map((p: PortPlanEntry) => ({
    label: labelForPortKey(p.key),
    port: finalPorts[p.key],
    fromDefault: finalPorts[p.key] === p.default,
  })));
  return finalPorts;
}

async function bootstrap(
  _hubStoreFactory: HubStoreFactory,
  flags: InitFlags,
  ports: HubPorts,
  onStep: (msg: string) => void,
): Promise<{ ok: true } | { ok: false; stage: string; details: string }> {
  const platform = new NodePlatformProbe();
  const docker = new CliDockerControl(platform);
  const { PgReadinessProbe, PostgresWorkspaceStore, createPool } =
    await import('../../adapters/postgres/index.js');
  const hubCredentials = { user: 'argustack', password: 'argustack_hub', database: 'argustack_hub' };
  const readinessProbe = new PgReadinessProbe(hubCredentials);
  const workspaceStoreFactory = (port: number): { store: IWorkspaceStore; close: () => Promise<void> } => {
    const pool = createPool({ host: 'localhost', port, ...hubCredentials });
    return {
      store: new PostgresWorkspaceStore(pool),
      close: async (): Promise<void> => { await pool.end(); },
    };
  };
  const useCase = new BootstrapHubUseCase(docker, readinessProbe, workspaceStoreFactory);
  const templates = getTemplatesDir();
  const result = await useCase.execute({
    hubDir: hubDir(),
    templateComposePath: join(templates, 'hub-docker-compose.yml'),
    templateConfigEnvPath: join(templates, 'hub-config.env'),
    ports,
    ...(flags.skipDocker === true ? { skipDocker: true } : {}),
    onStep,
  });
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, stage: result.stage, details: result.details };
}

function writeNoLlm(ports: HubPorts): void {
  const writeRes = new WriteConfigEnvUseCase().execute({ ports, targetPath: hubConfigPath() });
  if (!writeRes.ok) {
    printWriteConfigFailed(writeRes.details);
    process.exit(1);
  }
  resetHubConfigCache();
}

async function setupLlm(
  flags: InitFlags,
  platform: NodePlatformProbe,
  ollama: HttpOllamaControl,
  probe: ProbeLlmUseCase,
): Promise<LlmSetupPlan | null> {
  if (flags.interactive === false) {
    return setupOllama(platform, ollama, probe);
  }

  const hasOwn = await promptOwnLlm();
  if (hasOwn) {
    return setupOwnLlm(platform, ollama, probe);
  }
  return setupOllama(platform, ollama, probe);
}

async function setupOwnLlm(
  platform: NodePlatformProbe,
  ollama: HttpOllamaControl,
  probe: ProbeLlmUseCase,
): Promise<LlmSetupPlan | null> {
  let attempts = 0;
  while (attempts < MAX_PROBE_ATTEMPTS) {
    const { url, model } = await promptOwnLlmUrlAndModel();
    const spinner = ora('Probing LLM').start();
    const result = await probe.execute({ url, model });
    spinner.stop();
    attempts += 1;
    if (result.ok) {
      return { provider: 'custom', url, model, dimensions: result.dims };
    }
    printProbeError(result.kind, result.details);
    const choice = await promptProbeRetry();
    if (choice === 'use-ollama') {
      return setupOllama(platform, ollama, probe);
    }
    if (choice === 'skip') {
      return null;
    }
  }
  console.log(chalk.yellow('  Probe retry limit reached. Continuing without LLM.'));
  return null;
}

async function setupOllama(
  platform: NodePlatformProbe,
  ollama: HttpOllamaControl,
  probe: ProbeLlmUseCase,
): Promise<LlmSetupPlan | null> {
  const installed = await ollama.isInstalled();
  if (!installed) {
    const os = platform.detectOS();
    if (os === 'windows') {
      printOllamaWindowsLink();
      return null;
    }
    const installer = new InstallOllamaUseCase(ollama, platform);
    const spinner = ora('Installing Ollama').start();
    const result = await installer.execute();
    spinner.stop();
    if (!result.ok) {
      printOllamaInstallFailed(result.details);
      return null;
    }
    console.log(chalk.green(`  ✓ Ollama installed via ${result.via}`));
  }

  const runSpinner = ora('Starting Ollama').start();
  const run = await new EnsureOllamaRunningUseCase(ollama).execute();
  runSpinner.stop();
  if (!run.ok) {
    printOllamaTimeout();
    return null;
  }

  const modelSpinner = ora('Pulling embedding model').start();
  const ensured = await new EnsureEmbeddingModelUseCase(ollama).execute(
    DEFAULT_OLLAMA_MODEL,
    (pct) => { modelSpinner.text = `Pulling ${DEFAULT_OLLAMA_MODEL} (${String(pct)}%)`; },
  );
  modelSpinner.stop();
  if (!ensured.ok) {
    printPullFailed(ensured.kind, ensured.details);
    return null;
  }
  if (ensured.alreadyPresent) {
    console.log(chalk.dim(`  ${DEFAULT_OLLAMA_MODEL} already present`));
  } else {
    console.log(chalk.green(`  ✓ ${DEFAULT_OLLAMA_MODEL} pulled`));
  }

  const probeSpinner = ora('Probing embedding').start();
  const probed = await probe.execute({ url: DEFAULT_OLLAMA_URL, model: DEFAULT_OLLAMA_MODEL });
  probeSpinner.stop();
  if (!probed.ok) {
    printProbeError(probed.kind, probed.details);
    return null;
  }
  console.log(chalk.green(`  ✓ embedding works (${String(probed.dims)} dims)`));
  return { provider: 'ollama', url: DEFAULT_OLLAMA_URL, model: DEFAULT_OLLAMA_MODEL, dimensions: probed.dims };
}

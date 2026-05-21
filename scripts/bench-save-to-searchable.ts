#!/usr/bin/env tsx
/**
 * Save-to-Searchable Latency Benchmark
 *
 * Measures end-to-end latency from `writeFileSync` to the new symbol being
 * findable in Qdrant via `searchSemantic`. This validates the ARG-263 AC
 * "save-to-searchable < 3 seconds".
 *
 * How it works per iteration:
 *   1. Write `src/__bench__/BenchSymbol<i>_<timestamp>.ts` with a unique export.
 *   2. Record `writeAt = Date.now()`.
 *   3. Embed the symbol name via the same provider the watcher uses.
 *   4. Poll Qdrant every 200ms via `searchSemantic` until a point with
 *      `payload.name === <BenchSymbol>` appears (or timeout).
 *   5. Record `foundAt`, compute `latencyMs = foundAt - writeAt`.
 *   6. Delete the bench file.
 *
 * Output: per-iteration ms + summary (p50, p95, min, max).
 *
 * Usage:
 *   tsx scripts/bench-save-to-searchable.ts \
 *     --project <projectId> \
 *     [--iterations 5] \
 *     [--wait-ms 15000] \
 *     [--root <workspace-path-with-.env>]
 *
 * Prerequisites:
 *   - `argustack code register --name <name> --root <workspace>` has been run
 *   - `argustack code watch --project <projectId>` is RUNNING in another terminal
 *   - LM Studio (or chosen provider) is up; Neo4j + Qdrant containers healthy
 *
 * Reads from `<root>/.env`:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME — to fetch project metadata
 *   QDRANT_URL — REST endpoint
 *   LMSTUDIO_URL (optional) — for query embedding
 *
 * Example:
 *   tsx scripts/bench-save-to-searchable.ts \
 *     --project myapp \
 *     --iterations 10 \
 *     --root ~/dev/myapp
 *
 * Acceptance target (ARG-263): p50 < 2s, p95 < 5s, target SLO < 3s.
 */

import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { QdrantCodeVectorStore } from '../src/adapters/qdrant/index.js';
import { LmStudioCodeEmbeddingProvider } from '../src/adapters/lmstudio/index.js';
import { PostgresStorage } from '../src/adapters/postgres/index.js';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    iterations: { type: 'string', default: '5' },
    'wait-ms': { type: 'string', default: '15000' },
    root: { type: 'string', default: process.cwd() },
  },
});

if (!values.project) {
  console.error('Usage: tsx scripts/bench-save-to-searchable.ts --project <projectId>');
  process.exit(1);
}

const projectId = values.project;
const iterations = Number(values.iterations);
const maxWaitMs = Number(values['wait-ms']);
const projectRoot = resolve(values.root);

dotenv.config({ path: join(projectRoot, '.env') });

const dbConfig = {
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '5434', 10),
  database: process.env['DB_NAME'] ?? 'argustack',
  user: process.env['DB_USER'] ?? 'argustack',
  password: process.env['DB_PASSWORD'] ?? 'argustack_local',
};

const qdrantUrl = process.env['QDRANT_URL'];
if (!qdrantUrl) {
  console.error('QDRANT_URL not set in environment');
  process.exit(1);
}

const storage = new PostgresStorage(dbConfig);
const vec = new QdrantCodeVectorStore({ url: qdrantUrl });
const lmsOpts: ConstructorParameters<typeof LmStudioCodeEmbeddingProvider>[0] = {};
const lmstudioUrl = process.env['LMSTUDIO_URL'];
if (lmstudioUrl) {
  lmsOpts.url = lmstudioUrl;
}
const embedding = new LmStudioCodeEmbeddingProvider(lmsOpts);

const project = await storage.getProjectById(projectId);
if (!project) {
  console.error(`Project '${projectId}' not registered. Run \`argustack code register --name <name>\` first.`);
  process.exit(1);
}

const benchDir = join(project.root, 'src', '__bench__');
if (!existsSync(benchDir)) {
  mkdirSync(benchDir, { recursive: true });
}

console.log(`\n  Save-to-searchable benchmark`);
console.log(`  Project:    ${project.name} (${project.id})`);
console.log(`  Root:       ${project.root}`);
console.log(`  Iterations: ${String(iterations)}`);
console.log(`  Timeout:    ${String(maxWaitMs)}ms per iteration\n`);
console.log(`  NOTE: Make sure \`argustack code watch --project ${projectId}\` is running in another terminal.\n`);

const durations: number[] = [];

for (let i = 0; i < iterations; i++) {
  const symbolName = `BenchSymbol${String(i)}_${String(Date.now())}`;
  const fileName = `${symbolName}.ts`;
  const filePath = join(benchDir, fileName);
  const content = `export function ${symbolName}(): string {
  return 'bench-${String(i)}-${String(Date.now())}';
}
`;

  writeFileSync(filePath, content);
  const writeAt = Date.now();
  process.stdout.write(`  [${String(i + 1)}/${String(iterations)}] ${symbolName} ... `);

  const queryVec = await embedding.embedQuery(symbolName);
  const deadline = writeAt + maxWaitMs;
  let foundAt: number | null = null;

  while (Date.now() < deadline) {
    try {
      const hits = await vec.searchSemantic(projectId, queryVec, { topK: 5 });
      if (hits.some((h) => h.payload.name === symbolName)) {
        foundAt = Date.now();
        break;
      }
    } catch {
      // ignore, retry
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  try { unlinkSync(filePath); } catch { /* ignore */ }

  if (foundAt === null) {
    console.log(`TIMEOUT (>${String(maxWaitMs)}ms)`);
    durations.push(maxWaitMs);
  } else {
    const latency = foundAt - writeAt;
    durations.push(latency);
    console.log(`${String(latency)}ms`);
  }
}

await vec.close();
await storage.close();

durations.sort((a, b) => a - b);
const median = durations[Math.floor(durations.length / 2)] ?? 0;
const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
const p95 = durations[p95Index] ?? 0;
const max = durations[durations.length - 1] ?? 0;
const min = durations[0] ?? 0;

console.log(`\n  Results (n=${String(durations.length)}):`);
console.log(`    p50: ${String(median)}ms`);
console.log(`    p95: ${String(p95)}ms`);
console.log(`    min: ${String(min)}ms / max: ${String(max)}ms`);
console.log('');

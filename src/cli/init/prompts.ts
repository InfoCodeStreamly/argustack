import { input, confirm, select } from '@inquirer/prompts';

export async function promptWaitForDocker(): Promise<boolean> {
  return confirm({
    message: 'Wait until you start Docker (Orbstack / Docker Desktop)?',
    default: true,
  });
}

export async function promptWorkspaceName(existing: readonly string[]): Promise<string> {
  const suffix = existing.length > 0
    ? `\n  Existing: ${existing.join(', ')}`
    : '';
  return input({
    message: `Workspace name (lowercase letters, digits, dashes):${suffix}`,
    validate: (val): string | true => {
      const trimmed = val.trim();
      if (trimmed.length === 0) { return 'Required'; }
      if (!/^[a-z0-9-]+$/.test(trimmed)) {
        return 'Only a-z, 0-9, dashes allowed';
      }
      if (trimmed.length > 64) { return 'Max 64 chars'; }
      return true;
    },
  });
}

export async function promptConfigureCode(): Promise<boolean> {
  return confirm({
    message: 'Configure code intelligence (graph + semantic search of your code)?',
    default: true,
  });
}

export async function promptOwnLlm(): Promise<boolean> {
  return confirm({
    message: 'Do you already have a local LLM running (LM Studio / llama-server / custom)?',
    default: false,
  });
}

export interface OwnLlmInput {
  readonly url: string;
  readonly model: string;
}

export async function promptOwnLlmUrlAndModel(): Promise<OwnLlmInput> {
  const url = await input({
    message: 'LLM embedding URL (e.g. http://localhost:1234):',
    validate: (val): string | true =>
      /^https?:\/\//.test(val.trim()) ? true : 'Must start with http(s)://',
  });
  const model = await input({
    message: 'Model name (e.g. nomic-embed-text):',
    validate: (val): string | true => val.trim().length > 0 ? true : 'Required',
  });
  return { url: url.trim(), model: model.trim() };
}

export type ProbeRetryChoice = 'edit' | 'use-ollama' | 'skip';

export async function promptProbeRetry(): Promise<ProbeRetryChoice> {
  return select<ProbeRetryChoice>({
    message: 'LLM probe failed. What now?',
    choices: [
      { value: 'edit', name: 'Edit URL / model and retry' },
      { value: 'use-ollama', name: 'Switch to local Ollama (recommended)' },
      { value: 'skip', name: 'Skip — finish without LLM' },
    ],
  });
}

export async function promptDimsRecreate(existingDims: number, newDims: number): Promise<boolean> {
  return confirm({
    message:
      `Embedding dimensions changed (${String(existingDims)} → ${String(newDims)}). ` +
      `Qdrant collection must be re-created (existing vectors lost). Proceed?`,
    default: false,
  });
}

export async function promptReconfigureBrokenLlm(): Promise<boolean> {
  return confirm({
    message: 'Existing LLM config is not responding. Reconfigure now?',
    default: true,
  });
}

export type PortDecision =
  | { choice: 'accept-suggested' }
  | { choice: 'custom'; port: number }
  | { choice: 'abort' };

/**
 * Ask the user how to handle a port conflict. `defaultPort` is the
 * argustack default; `suggested` is the next free port found, or
 * null if scanning failed.
 */
export async function promptPortChoice(
  label: string,
  defaultPort: number,
  conflictDetails: string,
  suggested: number | null,
): Promise<PortDecision> {
  const choices: { value: 'accept-suggested' | 'custom' | 'abort'; name: string }[] = [];
  if (suggested !== null) {
    choices.push({ value: 'accept-suggested', name: `Use port ${String(suggested)} (next free)` });
  }
  choices.push({ value: 'custom', name: 'Enter custom port' });
  choices.push({ value: 'abort', name: 'Abort init' });

  const answer = await select<'accept-suggested' | 'custom' | 'abort'>({
    message: `Port ${String(defaultPort)} for ${label} is busy (${conflictDetails}). What to do?`,
    choices,
  });
  if (answer === 'accept-suggested' && suggested !== null) {
    return { choice: 'accept-suggested' };
  }
  if (answer === 'abort') {
    return { choice: 'abort' };
  }
  const raw = await input({
    message: `Enter port for ${label} (1024-65535):`,
    default: suggested !== null ? String(suggested) : String(defaultPort + 1),
    validate: (val): string | true => {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1024 || n > 65535) {
        return 'Must be integer 1024..65535';
      }
      return true;
    },
  });
  return { choice: 'custom', port: Number(raw) };
}

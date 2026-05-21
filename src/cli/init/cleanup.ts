type CleanupHandler = () => void | Promise<void>;

const handlers: CleanupHandler[] = [];
let installed = false;

/**
 * Register a cleanup handler that runs on SIGINT / SIGTERM / uncaught
 * exception. Handlers run in reverse registration order so resources
 * acquired last are released first (LIFO).
 *
 * @returns A disposer that unregisters the handler when called manually.
 */
export function onCleanup(handler: CleanupHandler): () => void {
  handlers.push(handler);
  ensureInstalled();
  return (): void => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) {
      handlers.splice(idx, 1);
    }
  };
}

function ensureInstalled(): void {
  if (installed) {
    return;
  }
  installed = true;
  const trigger = async (signal: string): Promise<void> => {
    for (const handler of [...handlers].reverse()) {
      try {
        await handler();
      } catch {
        /* swallow — we're already exiting */
      }
    }
    process.exit(signal === 'SIGINT' ? 130 : 1);
  };
  process.on('SIGINT', () => { void trigger('SIGINT'); });
  process.on('SIGTERM', () => { void trigger('SIGTERM'); });
}

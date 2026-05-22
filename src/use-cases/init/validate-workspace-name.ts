import type { IWorkspaceStore } from '../../core/ports/workspace-store.js';

export type WorkspaceNameAction = 'create' | 'switch';

export type ValidateWorkspaceNameResult =
  | { ok: true; action: WorkspaceNameAction; id: string; name: string }
  | { ok: false; reason: 'empty' | 'invalid-slug' };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Validate user-supplied workspace name and decide whether it should be
 * created fresh or used to switch to an existing entry.
 *
 * - Empty / invalid slug → `{ ok: false, reason }` — caller re-prompts.
 * - Valid slug + new → `{ action: 'create' }` — caller calls store.create.
 * - Valid slug + already in DB → `{ action: 'switch' }` — caller just
 *   marks it active without writing the row.
 */
export class ValidateWorkspaceNameUseCase {
  constructor(private readonly hubStore: IWorkspaceStore) {}

  async execute(rawName: string): Promise<ValidateWorkspaceNameResult> {
    const trimmed = rawName.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'empty' };
    }
    const slug = slugify(trimmed);
    if (!SLUG_RE.test(slug)) {
      return { ok: false, reason: 'invalid-slug' };
    }
    const existing = (await this.hubStore.getById(slug)) ?? (await this.hubStore.getByName(slug));
    if (existing !== null) {
      return { ok: true, action: 'switch', id: existing.id, name: existing.name };
    }
    return { ok: true, action: 'create', id: slug, name: slug };
  }
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

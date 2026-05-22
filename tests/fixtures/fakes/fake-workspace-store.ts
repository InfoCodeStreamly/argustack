import type { IWorkspaceStore } from '../../../src/core/ports/workspace-store.js';
import type { Workspace, WorkspaceSettings } from '../../../src/core/types/index.js';

export class FakeWorkspaceStore implements IWorkspaceStore {
  readonly name = 'Fake';

  private readonly store = new Map<string, Workspace>();
  public createCalls: Workspace[] = [];
  public removeCalls: string[] = [];

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  async create(workspace: Workspace): Promise<Workspace> {
    const now = new Date().toISOString();
    const existing = this.store.get(workspace.id);
    const merged: Workspace = {
      id: workspace.id,
      name: workspace.name,
      ...(workspace.displayName !== undefined ? { displayName: workspace.displayName } : {}),
      createdAt: existing?.createdAt ?? workspace.createdAt ?? now,
      lastActiveAt: existing?.lastActiveAt ?? workspace.lastActiveAt ?? now,
      settings: { ...(existing?.settings ?? {}), ...(workspace.settings ?? {}) },
    };
    this.store.set(workspace.id, merged);
    this.createCalls.push(merged);
    return Promise.resolve(merged);
  }

  async getById(id: string): Promise<Workspace | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  async getByName(name: string): Promise<Workspace | null> {
    for (const w of this.store.values()) {
      if (w.name === name) { return Promise.resolve(w); }
    }
    return Promise.resolve(null);
  }

  async list(): Promise<Workspace[]> {
    return Promise.resolve([...this.store.values()].sort((a, b) =>
      (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''),
    ));
  }

  async updateSettings(id: string, patch: Partial<WorkspaceSettings>): Promise<void> {
    const w = this.store.get(id);
    if (w === undefined) { return Promise.resolve(); }
    this.store.set(id, { ...w, settings: { ...(w.settings ?? {}), ...patch } });
    return Promise.resolve();
  }

  async remove(id: string): Promise<void> {
    this.removeCalls.push(id);
    this.store.delete(id);
    return Promise.resolve();
  }

  async touchActive(id: string): Promise<void> {
    const w = this.store.get(id);
    if (w === undefined) { return Promise.resolve(); }
    this.store.set(id, { ...w, lastActiveAt: new Date().toISOString() });
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

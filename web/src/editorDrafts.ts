/** Account/document-scoped editor drafts. These are never write receipts. */
export interface DraftScope { accountId: string; planId: string | null; documentId: string }
export const CREATION_DOCUMENT_ID = 'creation:reviewed-workout';
export interface EditorDraft<T> { id: string; revision: number; version: number; value: T; dirty?: boolean }
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type DraftRead<T> = EditorDraft<T> | 'unreadable' | null;
export const draftKey = (scope: DraftScope): string => `tresfort.editorDraft.v1.${encodeURIComponent(JSON.stringify([scope.accountId, scope.planId, scope.documentId]))}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The memory copy survives navigation when browser storage is unavailable. */
export class EditorDraftStore {
  private memory = new Map<string, { accountId: string; raw: string | null }>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(private storage: () => DraftStorage | null, private uuid: () => string = () => crypto.randomUUID()) {}

  /** Stable primitive snapshot for useSyncExternalStore, including mount races. */
  snapshot(scope: DraftScope): string | null {
    const key = draftKey(scope);
    let raw = this.memory.get(key)?.raw;
    if (raw === undefined) {
      try { raw = this.storage()?.getItem(key) ?? null; } catch { raw = null; }
      this.memory.set(key, { accountId: scope.accountId, raw });
    }
    return raw;
  }

  subscribe(scope: DraftScope, listener: () => void): () => void {
    const key = draftKey(scope);
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }

  read<T>(scope: DraftScope, validate: (value: unknown) => value is T): DraftRead<T> {
    const raw = this.snapshot(scope);
    if (raw === null) return null;
    try {
      const record: unknown = JSON.parse(raw);
      if (!object(record) || record.accountId !== scope.accountId || record.planId !== scope.planId
          || record.documentId !== scope.documentId || typeof record.id !== 'string'
          || (scope.planId === null && scope.documentId !== CREATION_DOCUMENT_ID)
          || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1
          || !Number.isSafeInteger(record.version)
          || Number(record.version) < (scope.planId === null && scope.documentId === CREATION_DOCUMENT_ID ? 0 : 1)
          || !validate(record.value)) return 'unreadable';
      return { id: record.id, revision: Number(record.revision), version: Number(record.version), value: record.value, dirty: record.dirty !== false };
    } catch { return 'unreadable'; }
  }

  write<T>(scope: DraftScope, previous: EditorDraft<T> | null, value: T, version: number, dirty = true): EditorDraft<T> {
    const record = { id: previous?.id ?? this.uuid(), revision: (previous?.revision ?? 0) + 1, version, value, dirty };
    this.persist(scope, JSON.stringify({ ...scope, ...record }));
    return record;
  }

  /** A completed request cannot erase edits made after that request began. */
  clear(scope: DraftScope, expected?: Pick<EditorDraft<unknown>, 'id' | 'revision'>): boolean {
    const key = draftKey(scope), raw = this.memory.get(key)?.raw;
    if (expected) {
      try {
        const current = JSON.parse(raw ?? this.storage()?.getItem(key) ?? 'null') as EditorDraft<unknown> | null;
        if (!current || current.id !== expected.id || current.revision !== expected.revision) return false;
      } catch { return false; }
    }
    this.persist(scope, null);
    return true;
  }

  hasDrafts(accountId: string): boolean {
    return [...this.memory.values()].some(entry => {
      if (entry.accountId !== accountId || entry.raw === null) return false;
      try { return JSON.parse(entry.raw).dirty !== false; } catch { return true; }
    });
  }

  private persist(scope: DraftScope, raw: string | null) {
    const key = draftKey(scope);
    this.memory.set(key, { accountId: scope.accountId, raw });
    try {
      if (raw === null) this.storage()?.removeItem(key);
      else this.storage()?.setItem(key, raw);
    } catch { /* The live copy remains available; the unload guard protects it. */ }
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
}

export const editorDraftStore = new EditorDraftStore(() => {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
});

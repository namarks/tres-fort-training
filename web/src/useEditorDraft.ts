import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { draftKey, editorDraftStore, type DraftScope, type EditorDraft } from './editorDrafts';

/** Acknowledgments update the currently mounted editor, even after navigation. */
export function useEditorDraft<T>(scope: DraftScope, validate: (value: unknown) => value is T) {
  const key = draftKey(scope);
  const boundScope = useMemo(() => scope, [key]);
  const subscribe = useCallback((listener: () => void) => editorDraftStore.subscribe(boundScope, listener), [boundScope]);
  const snapshot = useCallback(() => editorDraftStore.snapshot(boundScope), [boundScope]);
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
  const record = useMemo(() => editorDraftStore.read(boundScope, validate), [raw, boundScope, validate]);
  const current = record === 'unreadable' ? null : record;
  const save = (value: T, version: number, dirty = true) => {
    const latest = editorDraftStore.read(boundScope, validate);
    return editorDraftStore.write(boundScope, latest === 'unreadable' ? null : latest, value, version, dirty);
  };
  const clear = (expected?: EditorDraft<T>) => editorDraftStore.clear(boundScope, expected);
  return { record: current, unreadable: record === 'unreadable', save, clear };
}

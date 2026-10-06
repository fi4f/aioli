import { policy } from './editor-policy.js';
export function openTabs(state, sources, editor) {
  return (state['open-tabs'] = policy('editor-open-tabs', [state, sources], editor));
}
export function openTab(state, sources, key, editor) {
  Object.assign(state, policy('editor-open-tab', [state, sources, key], editor));
}
export function closeTab(state, sources, key, editor) {
  Object.assign(state, policy('editor-close-tab', [state, sources, key], editor));
}
export function renameTab(state, sources, oldKey, newKey, editor) {
  Object.assign(state, policy('editor-rename-tab', [state, sources, oldKey, newKey], editor));
}
// State collections are persistent. Shallow snapshots avoid rerunning interpreted
// layout on every paint, while edits, source changes and new definitions invalidate it.
const layouts = new WeakMap();
const unchanged = (snapshot, value) =>
  Object.keys(snapshot).length === Object.keys(value).length &&
  Object.entries(snapshot).every(([key, entry]) => value[key] === entry);
export function tabLayout(state, sources, committed, width, editor) {
  const cached = layouts.get(state);
  if (
    cached &&
    cached.width === width &&
    cached.editor === editor &&
    cached.version === editor?.definitionVersion &&
    unchanged(cached.state, state) &&
    unchanged(cached.sources, sources) &&
    unchanged(cached.committed, committed)
  )
    return cached.result;
  const result = policy('editor-tab-layout', [state, sources, committed, width], editor);
  Object.assign(state, result.state);
  layouts.set(state, {
    width,
    editor,
    version: editor?.definitionVersion,
    state: { ...state },
    sources: { ...sources },
    committed: { ...committed },
    result,
  });
  return result;
}

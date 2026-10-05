import { sourcePath } from './project-paths.js';
import { policy } from './editor-policy.js';
const entries = ['main', 'game'];
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
/** Fit whole tabs, with working overflow navigation and active-tab visibility. */
export function tabLayout(state, sources, committed, width, editor) {
  const tabs = openTabs(state, sources, editor);
  const widths = tabs.map((key) =>
    Math.min(
      192,
      Math.max(
        64,
        (entries.includes(key) ? key : sourcePath(key).split('/').at(-1)).length * 8 + 48,
      ),
    ),
  );
  const available = Math.max(64, width - 48);
  const offset = Number.isFinite(state['tab-offset']) ? Math.floor(state['tab-offset']) : 0;
  let start = Math.max(0, Math.min(tabs.length - 1, offset));
  const active = tabs.indexOf(state.tab);
  if ((state['tab-last'] !== state.tab || state['tab-width'] !== width) && active >= 0) {
    if (active < start) start = active;
    while (widths.slice(start, active + 1).reduce((a, b) => a + b, 0) > available && start < active)
      start++;
  }
  state['tab-last'] = state.tab;
  state['tab-width'] = width;
  state['tab-offset'] = start;
  const rows = [];
  let x = 0;
  for (let i = start; i < tabs.length && rows.length < 64; i++) {
    const w = Math.min(widths[i], available);
    if (x + w > available) break;
    const key = tabs[i];
    rows.push([
      key,
      entries.includes(key) ? key : sourcePath(key).split('/').at(-1),
      x,
      w,
      key in sources && sources[key] !== committed[key],
    ]);
    x += w;
  }
  return { rows, before: start > 0, after: start + rows.length < tabs.length };
}

import { sourcePath } from './project.js';

const entries = ['scene', 'game', 'audio', 'editor', 'ui'];
const readOnly = ['wgsl', 'guide', 'diagnostic'];
const valid = (key, sources) =>
  typeof key === 'string' &&
  key &&
  !key.startsWith('__') &&
  (key in sources || readOnly.includes(key));

/** Tabs are workspace state; source, selection, undo and scroll stay in buffers. */
export function openTabs(state, sources) {
  let tabs;
  try {
    tabs = JSON.parse(state['open-tabs']);
  } catch {
    tabs = entries;
  }
  if (!Array.isArray(tabs)) tabs = entries;
  tabs = [...new Set(tabs.filter((key) => typeof key === 'string' && valid(key, sources)))];
  // Also honor Lisp programs that select a source with (set! :tab ...).
  if (valid(state.tab, sources) && !tabs.includes(state.tab)) tabs.push(state.tab);
  state['open-tabs'] = JSON.stringify(tabs);
  return tabs;
}

export function openTab(state, sources, key) {
  if (!valid(key, sources)) throw new Error(`Unknown source buffer ${key}`);
  const tabs = openTabs(state, sources);
  if (!tabs.includes(key)) tabs.push(key);
  state['open-tabs'] = JSON.stringify(tabs);
  state.tab = key;
  state['tab-last'] = '';
}

export function closeTab(state, sources, key) {
  const tabs = openTabs(state, sources),
    index = tabs.indexOf(key);
  const next = tabs.filter((tab) => tab !== key);
  if (state.tab === key) state.tab = next[Math.min(index, next.length - 1)] ?? '';
  state['open-tabs'] = JSON.stringify(next);
}

export function renameTab(state, sources, oldKey, newKey) {
  // Read before validating: the old source has already moved in the file store.
  let tabs;
  try {
    tabs = JSON.parse(state['open-tabs']);
  } catch {
    tabs = entries;
  }
  if (!Array.isArray(tabs)) tabs = entries;
  state['open-tabs'] = JSON.stringify(tabs.map((key) => (key === oldKey ? newKey : key)));
  if (state.tab === oldKey) state.tab = newKey;
  openTabs(state, sources);
}

/** Fit whole tabs, with working overflow navigation and active-tab visibility. */
export function tabLayout(state, sources, committed, width) {
  const tabs = openTabs(state, sources);
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

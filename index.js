import hg from './hg/hg.js';
import { Data } from './hg/data.js';
import { Types } from './hg/types.js';
import { SceneMemory } from './hg/scene-memory.js';

const source = document.getElementById('source');
const run = document.getElementById('run');
const patch = document.getElementById('patch');
const error = document.getElementById('error');
const app = hg.App.new({ c: 'canvas' });
const inspection = {
  status: document.getElementById('inspection-status'),
  javascript: document.getElementById('compiled-javascript'),
  wgsl: document.getElementById('compiled-wgsl'),
  sceneStatus: document.getElementById('scene-bindings-status'),
  sceneBindings: document.getElementById('scene-bindings'),
  compilerBindings: document.getElementById('compiler-bindings'),
};

function __snapshot__(value, seen, budget, depth = 0) {
  if (budget.remaining-- <= 0 || depth > 4) return '[Preview limit]';
  if (value == null) return null;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') {
    const source = Function.prototype.toString.call(value);
    return source.length > 2000 ? `${source.slice(0, 2000)}…` : source;
  }
  const type = Types.type(value);
  if (type === '__promise__') return '[Promise]';
  if (type === '__texture2d__')
    return { __type__: type, w: Data.get(value, 'w'), h: Data.get(value, 'h') };
  if (type === '__binding__') return { __type__: type, name: value.name };
  if (Data.isHostData(value)) return '[Host record]';
  if (seen.has(value)) return '[Circular reference]';
  seen.add(value);
  try {
    const kind = Data.dataKind(value);
    if (['list', 'array', 'many'].includes(kind)) {
      const length = Data.len(value);
      const items = [];
      for (let i = 0; i < length && i < 50 && budget.remaining > 0; i++)
        items.push(__snapshot__(Data.get(value, i), seen, budget, depth + 1));
      if (items.length < length) items.push(`[${length - items.length} more items]`);
      return items;
    }
    if (['dict', 'struct', 'error'].includes(kind)) {
      const values = kind === 'struct' ? Data.values(value) : (Data.bindingCells(value) ?? value);
      const keys = Object.keys(values);
      const entries = [];
      for (const key of keys) {
        if (entries.length === 50 || budget.remaining <= 0) break;
        entries.push([key, __snapshot__(Data.get(value, key), seen, budget, depth + 1)]);
      }
      if (entries.length < keys.length)
        entries.push(['[Preview limit]', `${keys.length - entries.length} more fields`]);
      return Object.fromEntries(entries);
    }
    return JSON.parse(Data.serializeData(value));
  } finally {
    seen.delete(value);
  }
}

function __bindingRow__(columns, read) {
  const row = document.createElement('tr');
  let type, preview;
  try {
    const value = read();
    type = Types.type(value);
    preview = __snapshot__(value, new WeakSet(), { remaining: 200 });
    preview = typeof value === 'function' ? preview : JSON.stringify(preview, null, 2);
  } catch (failure) {
    type ??= 'Unavailable';
    preview = failure.message;
  }
  for (const content of [...columns, type, preview]) {
    const cell = document.createElement('td');
    const text = document.createElement('pre');
    text.textContent = content;
    cell.append(text);
    row.append(cell);
  }
  return row;
}

function refreshInspection() {
  const program = SceneMemory.program(app.scene);
  inspection.javascript.value = program?.javascript ?? '';
  inspection.wgsl.value =
    program?.shaders
      .map((shader, index) => `// Shader ${index}: $shaders[${index}]\n${shader.wgsl}`)
      .join('\n\n') ?? '';
  if (program && !program.shaders.length)
    inspection.wgsl.value = '// No Lisp shaders in this scene.';
  inspection.status.textContent = program
    ? 'Compiled output from the active scene. Editing the source does not change these views.'
    : 'Load or patch source to inspect it.';
  inspection.compilerBindings.replaceChildren(
    ...Object.entries(program?.bindings ?? {}).map(([name, value], index) =>
      __bindingRow__([`$binding${index}`, name], () => value),
    ),
  );
  try {
    const bindings = Object.entries(hg.App.inspect(app));
    inspection.sceneBindings.replaceChildren(
      ...bindings.map(([name, reference]) =>
        __bindingRow__([name], () => hg.App.read(app, reference)),
      ),
    );
    inspection.sceneStatus.textContent = bindings.length
      ? `${bindings.length} top-level bindings.`
      : program
        ? 'No top-level bindings in the active scene.'
        : 'No scene has been loaded.';
  } catch (failure) {
    inspection.sceneBindings.replaceChildren();
    inspection.sceneStatus.textContent = failure.message;
  }
}

async function replaceScene(replace) {
  error.textContent = '';
  try {
    await replace(app, source.value);
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    refreshInspection();
  }
}

run.addEventListener('click', () => replaceScene(hg.App.loadSource));
patch.addEventListener('click', () => replaceScene(hg.App.patchSource));
document.getElementById('refresh-inspection').addEventListener('click', refreshInspection);
for (const id of ['javascript-inspection', 'wgsl-inspection', 'bindings-inspection']) {
  const panel = document.getElementById(id);
  panel.addEventListener('toggle', () => {
    if (panel.open) refreshInspection();
  });
}

app.ready.catch((failure) => {
  error.textContent = failure.message;
});
window.addEventListener('pagehide', () => hg.App.dispose(app), { once: true });

import { parse, createRuntime } from './lisp.js';
import { compileShader } from './shader.js';
import { defaults as examples, presets } from './examples.js';
import { validateVoice, synthesize, wav } from './audio.js';
import { DrawList } from './drawing.js';
import { GPUHost } from './gpu.js';
import { CodeInput } from './code-input.js';
import { projectTree, toggleFolder } from './file-tree.js';
import { generatorSources } from './generators.js';
import {
  entryPaths,
  sourcePath,
  sourceKey,
  resolvePath,
  resolveModules,
  cpuForms,
  pixelHook,
  projectSnapshot,
  readProject,
} from './project.js';

/** Browser services for the Lisp editor; appearance and layout stay in Lisp. */
const $ = (id) => document.getElementById(id),
  canvas = $('app'),
  storageKey = 'aioli.project.v3';
// Resolve against this module, not the domain root, for GitHub Pages subpaths.
async function loadBundledSource(filename) {
  const response = await fetch(new URL(filename, import.meta.url));
  if (!response.ok) throw new Error(`Unable to load ${filename}: HTTP ${response.status}`);
  return response.text();
}
const defaults = {
  ...examples,
  editor: await loadBundledSource('editor.lisp'),
  ui: await loadBundledSource('ui.lisp'),
  ...generatorSources,
};
const sources = Object.assign(Object.create(null), defaults);
let resources = Object.create(null),
  generatedSound;
const transientBuffers = { __palette: '', __path: 'lib/new.lisp' };
Object.assign(sources, transientBuffers);
const resourceRows = () => [
  ...Object.keys(sources)
    .filter(
      (key) =>
        !key.startsWith('__') && !['generators/image.lisp', 'generators/audio.lisp'].includes(key),
    )
    .map((key) => [sourcePath(key), 'lisp', key]),
  ...Object.keys(resources).map((path) => [path, 'asset', path, resources[path].mime]),
];
let state = Object.create(null),
  runtime,
  rescueRuntime,
  compiled,
  gpu,
  lastDraw,
  regions = [];
let committedSources = { ...sources },
  time = 0,
  revision = 0,
  timer,
  lastFrame = performance.now(),
  dirty = false,
  lastSave = 0;
let message = 'Starting…',
  error = false,
  pending = false,
  recovery = false,
  gameFailed = false,
  editorFailed = false;
let gpuFailure = '';
let visibleWindow = '',
  focusPalette = false,
  focusPath = false;
let audioContext,
  samples,
  audioSignature = '',
  lastAudio = 0,
  voices = [];
const keys = new Set(),
  pointer = {
    x: -1,
    y: -1,
    down: false,
    pressed: false,
    moved: false,
    capture: null,
    target: null,
  },
  activations = new Set();
const guide = `AIOLI / all in one lisp

The editor is an aioli app.
Edit editor.lisp for layout and behavior.
Edit ui.lisp for button and slider implementations.
Every visible element is a WebGPU pixel primitive.

Ctrl/Cmd+Enter  Evaluate all programs
F2             Recover the editor shell
Escape         Close tools and menus
Click game     A/D or arrows, Space to jump

DRAWING (CPU editor and GPU scenes)
  (fill "#bbd6a6")
  (rect [20 80] [120 32])
  (circle [60 100] 8)
  (line [0 0] [20 20] 2)
  (scope (translate [10 0]) ...)
  (opacity 0.5) (blend :add)

EDITOR PRIMITIVES
  (text [20 80] "Hello")
  (clip [0 0] [200 200])
  (surface [640 150] [640 480])
  (code-editor [16 100] [500 600] :editor)
  (screen-width) (screen-height)
  (hit? [20 80] [120 32])
  (pointer-pressed?) (pointer-down?)
  (pointer-x) (pointer-y)
  (capture! :id) (captured? :id)

LISP FUNCTIONS
  defn let do if when repeat scope
  init! set! get str count nth
  + - * / sin cos abs min max floor round clamp mod

Shaders use (defpixel name [p time] ...) and
compile into WGSL. (param :key) reads shared state.
The editor emits an ordered drawing stream that
WebGPU evaluates per pixel on a fullscreen quad.

Widgets in ui.lisp are ordinary Lisp functions.
You can change their shape, colors, layout, and
interaction logic while the app is running.

TEXT INPUT
Mouse selection, arrows, clipboard, and IME use
a hidden browser textarea. Text, selection, and
the caret are all visibly rendered in WebGPU.
Wheel scrolls source; Shift+wheel scrolls sideways.

AUDIO
(voice :sine 440 880 0.3 0.35)
Arguments: waveform, start Hz, end Hz, seconds, gain.
Waveforms: sine, triangle, square, sawtooth, noise.
The Sound tool edits the same shared parameters.

PROJECTS
File: open/save JSON and export images.
Project: evaluate, pause, reset and generators.
View: panes, palette, WGSL and recovery.
Edit: undo/redo and clipboard. About: help and docs.
The last accepted source and state save locally.
Bad edits retain the working app and shader.
F2 opens the stock recovery shell if an editor edit
hides the code view or breaks frame execution.

LIMITS
Small Lisp runtime, bounded frame evaluation.
No persistent GPU feedback or custom graph routing.
The host/compiler are JavaScript native bindings;
the editor app and widgets are Lisp source.

Full documentation: About > Documentation.
`;

/** Validate imports before evaluating them, while retaining legacy save support. */
function validateProject(project) {
  return readProject(project, defaults);
}

try {
  const saved = JSON.parse(
    localStorage.getItem(storageKey) ||
      localStorage.getItem('aioli.project.v2') ||
      localStorage.getItem('pixel-lisp.project.v2') ||
      localStorage.getItem('pixel-lisp.project.v1'),
  );
  if (saved) {
    const project = validateProject(saved);
    Object.assign(sources, project.sources);
    resources = project.resources;
    recovery = project.recovery;
    state = Object.assign(Object.create(null), project.state);
  }
} catch {}
committedSources = { ...sources };

function report(text, isError = false) {
  message = text;
  error = isError;
  pending = false;
  $('status').textContent = text;
}
function save() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(projectSnapshot(committedSources, state, resources, recovery)),
    );
    dirty = false;
    return true;
  } catch {
    report('Storage unavailable. Use File → Save project.', true);
    return false;
  }
}
function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function inBox(x, y, origin, size) {
  return x >= origin[0] && y >= origin[1] && x < origin[0] + size[0] && y < origin[1] + size[1];
}
function topRegion(x, y) {
  return regions.findLast((r) => inBox(x, y, r.origin, r.size));
}
function defer(action) {
  setTimeout(() => {
    try {
      Promise.resolve(action()).catch((error) => report(error.message, true));
    } catch (e) {
      report(e.message, true);
    }
  }, 0);
}
// A new keystroke invalidates any older asynchronous GPU compilation immediately.
const code = new CodeInput($('text-input'), sources, (tab) => {
  if (tab.startsWith('__')) return;
  revision++;
  clearTimeout(timer);
  timer = setTimeout(() => evaluate(), 500);
});

/**
 * Bind native services to one candidate's state. Validation candidates cannot
 * consume input or perform file/audio actions; only the active/recovery editor can.
 */
function makeRuntime(target) {
  let draw,
    items = [],
    patch = [],
    buffer = { rows: [], selections: [], caret: null };
  const live = () => result === runtime || result === rescueRuntime;
  const actions =
    (fn) =>
    (...args) => {
      if (live()) defer(() => fn(...args));
    };
  const result = createRuntime(target, {
    budget: 100000,
    key: (k) => code.focus === 'world' && keys.has(k),
    beginScope: () => draw?.scope(),
    endScope: () => draw?.restore(),
    voice: (...args) => {
      if (patch.length >= 16) throw new Error('Maximum 16 voices');
      patch.push(validateVoice(...args));
    },
    playSound: () => {
      if (live()) playPatch().catch((e) => report(e.message, true));
    },
    exportWav: () => {
      if (live()) exportWav();
    },
    primitives: {
      ...Object.fromEntries(
        [
          'background',
          'fill',
          'rect',
          'circle',
          'line',
          'text',
          'clip',
          'translate',
          'scale',
          'opacity',
          'blend',
        ].map((name) => [
          name,
          (...args) => {
            if (!draw) throw new Error(`${name} must be called from editor`);
            return draw.primitives()[name](...args);
          },
        ]),
      ),
      'screen-width': () => innerWidth,
      'screen-height': () => innerHeight,
      'edit-buffer': actions((action) => code.edit(action)),
      'can-edit-buffer?': (action) => code.canEdit(action),
      'prepare-file-path': actions((rename = false) => {
        const folder = state['context-kind'] === 'folder' ? state['context-path'] + '/' : '';
        sources.__path = rename ? state['selected-file'] : folder + 'new.lisp';
        state['file-operation'] = rename ? 'rename' : 'create';
        state['file-path-editing'] = false;
        state['file-context'] = false;
        state.window = 'file-path';
      }),
      'selected-file?': () =>
        sourceKey(target['selected-file'] ?? '') in sources ||
        (target['selected-file'] ?? '') in resources,
      'selected-file-removable?': () =>
        !Object.values(entryPaths).includes(target['selected-file']) &&
        !Object.keys(generatorSources).includes(target['selected-file']) &&
        (sourceKey(target['selected-file'] ?? '') in sources ||
          (target['selected-file'] ?? '') in resources),
      'open-recovery': actions(() => enterRecovery()),
      'menu-region': (id, label, origin, size, enabled, checked) =>
        items.push({ id, label, origin, size, disabled: !enabled, menuItem: true, checked }),
      'resource-region': (path, kind, assetKind, origin, size) =>
        items.push({
          id: `${kind === 'folder' ? 'folder' : 'file'}-${path}`,
          label: `${assetKind}: ${path}`,
          origin,
          size,
          resourcePath: path,
          resourceKind: kind,
          assetKind,
        }),
      'project-tree-offset': () => treeOffset(target),
      'project-tree': () =>
        projectTree(resourceRows(), target['open-folders']).slice(
          treeOffset(target),
          treeOffset(target) + 64,
        ),
      'project-tree-count': () => projectTree(resourceRows(), target['open-folders']).length,
      'toggle-folder': actions((path) => {
        state['open-folders'] = toggleFolder(state['open-folders'], path);
        state['file-offset'] = 0;
        dirty = true;
      }),
      'project-files': () =>
        [
          ...Object.keys(sources)
            .filter((key) => !key.startsWith('__'))
            .map((key) => [sourcePath(key), 'lisp', key]),
          ...Object.keys(resources).map((path) => [path, 'asset', path]),
        ]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(
            Math.max(0, target['file-offset'] ?? 0),
            Math.max(0, target['file-offset'] ?? 0) + 12,
          ),
      'project-file-count': () =>
        Object.keys(sources).filter((key) => !key.startsWith('__')).length +
        Object.keys(resources).length,
      'open-file': actions((path) => {
        const key = sourceKey(resolvePath(path));
        if (key in sources) {
          state.tab = key;
          state['show-code'] = true;
          if (innerWidth < 850) state['show-files'] = false;
          state['file-path-editing'] = false;
          state['selected-file'] = resolvePath(path);
          state.window = '';
        } else if (resources[path])
          report(
            `${path} • ${resources[path].mime ?? 'asset'} • ${Math.floor(resources[path].data.length * 0.75)} bytes`,
          );
        else throw new Error(`Missing file ${path}`);
      }),
      'create-file': actions((path, text = '; New project module\n') => {
        path = resolvePath(path);
        if (path.startsWith('__'))
          throw new Error('Names beginning with __ are reserved for input buffers');
        const key = sourceKey(path);
        if (!path.endsWith('.lisp')) throw new Error('Source files must end in .lisp');
        if (key in sources || path in resources) throw new Error(`File already exists: ${path}`);
        if (Object.keys(sources).length >= 258) throw new Error('Maximum 256 source files');
        if (typeof text !== 'string' || text.length > 100000)
          throw new Error('Invalid source text');
        sources[key] = text;
        state.tab = key;
        state['show-code'] = true;
        if (innerWidth < 850) state['show-files'] = false;
        state['file-path-editing'] = false;
        state['selected-file'] = path;
        state.window = '';
        evaluate();
      }),
      'rename-file': actions((oldPath, newPath) => {
        oldPath = resolvePath(oldPath);
        newPath = resolvePath(newPath);
        if (newPath.startsWith('__'))
          throw new Error('Names beginning with __ are reserved for input buffers');
        if (
          Object.values(entryPaths).includes(oldPath) ||
          Object.keys(generatorSources).includes(oldPath)
        )
          throw new Error('Keep entry, generator and stock command filenames stable');
        const oldKey = sourceKey(oldPath),
          newKey = sourceKey(newPath);
        if (newKey in sources || newPath in resources)
          throw new Error('Destination already exists');
        if (oldKey in sources) {
          if (!newPath.endsWith('.lisp')) throw new Error('Source files must end in .lisp');
          sources[newKey] = sources[oldKey];
          delete sources[oldKey];
          if (state.tab === oldKey) state.tab = newKey;
        } else if (resources[oldPath]) {
          resources[newPath] = resources[oldPath];
          delete resources[oldPath];
        } else throw new Error('Missing file');
        state['selected-file'] = newPath;
        if (state.window === 'file-path') state.window = '';
        // Explicit imports stay human-readable: report broken references rather
        // than silently rewriting source text during a rename.
        evaluate();
      }),
      'delete-file': actions((path) => {
        path = resolvePath(path);
        if (
          Object.values(entryPaths).includes(path) ||
          Object.keys(generatorSources).includes(path)
        )
          throw new Error('Entry and stock generator/command files cannot be deleted');
        const key = sourceKey(path);
        delete sources[key];
        delete resources[path];
        if (state.tab === key) state.tab = 'scene';
        evaluate();
      }),
      'import-resource': actions(() => $('resource-input').click()),
      'download-resource': actions((path) => {
        path = resolvePath(path);
        if (sourceKey(path) in sources)
          download(sources[sourceKey(path)], 'text/plain', path.split('/').at(-1));
        else if (resources[path]) {
          const a = document.createElement('a');
          a.href = resources[path].data;
          a.download = path.split('/').at(-1);
          a.click();
        } else throw new Error('Missing resource');
      }),
      'palette-query': () => sources.__palette,
      'palette-commands': () => {
        const query = sources.__palette.toLowerCase().trim();
        return Object.keys(sources)
          .filter(
            (key) =>
              key.startsWith('commands/') &&
              key.endsWith('.lisp') &&
              (!query || key.toLowerCase().includes(query)),
          )
          .sort()
          .slice(0, 8);
      },
      'run-command': actions((path) => runCommand(path)),
      'run-instruction': actions(() => runInstruction(sources.__palette)),
      'path-input': () => sources.__path,
      'image-preview': (origin, size) => draw.surface(origin, size, 5),
      'export-image': actions((path = 'assets/generated.png') => exportGeneratedImage(path, true)),
      'save-image-resource': actions((path = 'assets/generated.png') =>
        exportGeneratedImage(path, false),
      ),
      'play-generated-sound': actions(() => {
        refreshAudio();
        return playSamples(generatedSound);
      }),
      'export-sound': actions((path = 'assets/generated.wav') => exportGeneratedSound(path, true)),
      'save-sound-resource': actions((path = 'assets/generated.wav') =>
        exportGeneratedSound(path, false),
      ),
      'pointer-x': () => pointer.x,
      'pointer-y': () => pointer.y,
      'pointer-down?': () => live() && pointer.down,
      'pointer-pressed?': () => live() && pointer.pressed,
      'pointer-moved?': () => live() && pointer.moved,
      'hit?': (origin, size) => {
        const hit = inBox(pointer.x, pointer.y, origin, size);
        const top = pointer.down ? pointer.target : topRegion(pointer.x, pointer.y);
        return (
          live() &&
          hit &&
          (!top ||
            (top.origin[0] === origin[0] &&
              top.origin[1] === origin[1] &&
              top.size[0] === size[0] &&
              top.size[1] === size[1]))
        );
      },
      'capture!': (id) => {
        if (live()) pointer.capture = id;
      },
      'captured?': (id) => pointer.capture === id,
      'activated?': (id) => live() && activations.has(id),
      'focused?': (id) => document.activeElement?.dataset.region === id,
      region: (id, label, origin, size, key, low, high) => {
        if (!origin?.every(Number.isFinite) || !size?.every(Number.isFinite))
          throw new Error('Invalid interaction region');
        items.push({ id, label, origin, size, key, low, high });
      },
      surface: (origin, size) => {
        draw.surface(origin, size);
        items.push({ id: 'world', label: 'Game viewport', origin, size });
      },
      'buffer-open': (origin, size, tab) => {
        const text =
          tab === 'wgsl'
            ? compiled?.code || 'No compiled shader'
            : tab === 'guide'
              ? guide
              : tab === 'diagnostic'
                ? message
                : sources[tab];
        if (typeof text !== 'string') throw new Error(`Unknown source buffer ${tab}`);
        if (live()) {
          buffer = code.layout(origin, size, tab, text, !(tab in sources), performance.now());
          if ((tab === '__palette' && focusPalette) || (tab === '__path' && focusPath)) {
            focusPath = false;
            focusPalette = false;
            code.focus = 'code';
            keys.clear();
            $('text-input').focus({ preventScroll: true });
          }
          items.push({ id: 'source', label: 'Source editor', origin, size });
        }
      },
      'buffer-rows': () => buffer.rows,
      'buffer-selections': () => buffer.selections,
      'buffer-caret': () => buffer.caret,
      waveform: (origin, size, generated = false) => {
        const waveformSamples = generated ? generatedSound : samples;
        if (!waveformSamples) return;
        const count = Math.min(160, Math.floor(size[0]));
        for (let x = 0; x < count; x++) {
          const from = Math.floor((x / count) * waveformSamples.length),
            to = Math.floor(((x + 1) / count) * waveformSamples.length);
          let low = 0,
            high = 0;
          for (let i = from; i < to; i++) {
            low = Math.min(low, waveformSamples[i]);
            high = Math.max(high, waveformSamples[i]);
          }
          const xx = origin[0] + (x / count) * size[0];
          draw.line(
            [xx, origin[1] + size[1] * (0.5 + low * 0.45)],
            [xx, origin[1] + size[1] * (0.5 + high * 0.45)],
            1,
          );
        }
      },
      status: () => message,
      'error?': () => error,
      'evaluate-project': actions(() => evaluate()),
      'reset-project': actions(() => evaluate({ reset: true })),
      'recovery?': () => recovery,
      'leave-recovery': actions(() => {
        recovery = false;
        save();
        report('Using the project editor. F2 reopens recovery.');
      }),
      'upgrade-editor': actions(async () => {
        // Keep custom shell/library sources as ordinary root-level files so any
        // relative imports still resolve if a contributor opens the backups.
        const backups = ['editor', 'ui'].filter((key) => sources[key] !== defaults[key]);
        if (
          Object.keys(sources).filter((key) => !key.startsWith('__')).length + backups.length >
          256
        )
          throw new Error('Make room for editor backups before upgrading');
        for (const key of backups) {
          let index = 1;
          while (
            `${key}-backup-${index}.lisp` in sources ||
            `${key}-backup-${index}.lisp` in resources
          )
            index++;
          sources[`${key}-backup-${index}.lisp`] = sources[key];
        }
        sources.editor = defaults.editor;
        sources.ui = defaults.ui;
        if (await evaluate({ exitRecovery: true }))
          report('Latest editor installed. Previous custom sources are kept in backup files.');
      }),
      'export-project': actions(() =>
        download(
          JSON.stringify(projectSnapshot(sources, state, resources, recovery), null, 2),
          'application/json',
          'midnight-garden.aioli.json',
        ),
      ),
      'import-project': actions(() => $('file-input').click()),
      'open-docs': actions(() =>
        window.open(new URL('./docs/', import.meta.url).href, '_blank', 'noopener'),
      ),
      'export-png': actions(async () => {
        try {
          if (!gpu) throw new Error('WebGPU is unavailable');
          download(await gpu.snapshot(), 'image/png', 'aioli.png');
        } catch (e) {
          report(e.message, true);
        }
      }),
      'next-scene': actions(() => {
        const options = Object.values(presets),
          i = options.indexOf(sources.scene);
        sources.scene = options[(i + 1) % options.length];
        evaluate();
      }),
    },
  });
  result.drawEditor = () => {
    draw = new DrawList(innerWidth, innerHeight);
    items = [];
    try {
      result.call('editor');
      return { draw, regions: items };
    } finally {
      draw = null;
    }
  };
  result.collectSound = () => {
    patch = [];
    result.call('sound');
    if (!patch.length) throw new Error('sound must produce at least one voice');
    return patch;
  };
  result.collectGeneratedSound = () => {
    patch = [];
    result.call('generate-sound');
    if (!patch.length) throw new Error('generate-sound must produce at least one voice');
    return patch;
  };
  return result;
}
/** Stage all sources and a GPU pipeline, then commit only the newest valid edit. */
async function evaluate({ reset = false, imported = null, exitRecovery = false } = {}) {
  const id = ++revision;
  pending = true;
  message = 'Evaluating…';
  try {
    const candidateSources = { ...(imported?.sources ?? sources) },
      baseline = { ...state };
    // File operations and gameplay edits are not repairs to the editor. Keep
    // the recovery shell until its sources are explicitly changed and accepted.
    const editorChanged = ['editor', 'ui'].some(
      (key) => candidateSources[key] !== committedSources[key],
    );
    const nextRecovery = !exitRecovery && (imported?.recovery ?? (recovery && !editorChanged));
    const target = Object.assign(Object.create(null), imported?.state ?? (reset ? {} : state));
    const candidate = makeRuntime(target);
    for (const module of resolveModules(candidateSources, [
      'game',
      'ui',
      'editor',
      'audio',
      'scene',
      'generators/image.lisp',
      'generators/audio.lisp',
    ]))
      try {
        candidate.load(cpuForms(module.forms));
      } catch (e) {
        throw new Error(`${module.path}: ${e.message}`);
      }
    candidate.call('update', 0);
    candidate.drawEditor();
    candidate.collectSound();
    if (typeof candidate.global['scene-update'] === 'function') candidate.call('scene-update', 0);
    const shader = compileShader(pixelHook(resolveModules(candidateSources, ['scene'])), target),
      imageShader = compileShader(
        pixelHook(resolveModules(candidateSources, ['generators/image.lisp'])),
        target,
      ),
      pipeline = gpu ? await gpu.prepare(shader) : null,
      imagePipeline = gpu ? await gpu.prepare(imageShader) : null;
    const nextGeneratedSound = synthesize(candidate.collectGeneratedSound());
    if (id !== revision) return;
    // Preserve state updates that happened while the GPU was compiling.
    if (!reset && !imported)
      for (const [key, value] of Object.entries(state))
        if (value !== baseline[key] && target[key] === baseline[key]) target[key] = value;
    // Nothing above this point replaces the running program. Draft text remains
    // editable even if validation fails; persistence only uses committedSources.
    state = target;
    runtime = candidate;
    compiled = shader;
    for (const key of Object.keys(sources)) if (!key.startsWith('__')) delete sources[key];
    Object.assign(sources, candidateSources);
    if (imported) resources = imported.resources ?? Object.create(null);
    committedSources = { ...candidateSources };
    if (pipeline) gpu.commit(pipeline, shader);
    if (imagePipeline) gpu.commitImage(imagePipeline, imageShader);
    generatedSound = nextGeneratedSound;
    rescueRuntime = makeRuntime(state);
    rescueRuntime.load(parse(defaults.ui));
    rescueRuntime.load(parse(defaults.editor));
    gameFailed = false;
    editorFailed = false;
    recovery = nextRecovery;
    refreshAudio(true);
    if (save()) report(gpuFailure || 'Saved', Boolean(gpuFailure));
    return true;
  } catch (e) {
    if (id === revision) report(e.message, true);
    return false;
  }
}
function refreshAudio(force = false) {
  if (!runtime) return;
  const generatedPatch = runtime.collectGeneratedSound();
  const generatedSignature = JSON.stringify(generatedPatch);
  if (force || generatedSignature !== refreshAudio.generatedSignature) {
    generatedSound = synthesize(generatedPatch);
    refreshAudio.generatedSignature = generatedSignature;
  }
  const patch = runtime.collectSound(),
    signature = JSON.stringify(patch);
  if (!force && signature === audioSignature) return;
  voices = patch;
  samples = synthesize(voices);
  audioSignature = signature;
}
async function activateAudio() {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
}
async function playPatch() {
  refreshAudio();
  await playSamples(samples);
}
async function playSamples(pcm) {
  if (!pcm) throw new Error('No generated audio available');
  await activateAudio();
  const buffer = audioContext.createBuffer(1, pcm.length, 44100);
  buffer.copyToChannel(pcm, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();
  source.onended = () => source.disconnect();
}
function exportWav() {
  try {
    refreshAudio();
    download(wav(samples), 'audio/wav', 'aioli-patch.wav');
  } catch (e) {
    report(e.message, true);
  }
}

/** Commands execute only on request, with the interpreter's normal fuel limit.
 * They share live definitions/state; imports are resolved against their file.
 * Effects before an error remain, just as in an ordinary sequence of Lisp forms.
 */
function runCommand(path) {
  const modules = resolveModules(sources, [resolvePath(path)]);
  for (const module of modules) runtime.load(cpuForms(module.forms));
  dirty = true;
  report(`Executed ${path}`);
}
function runInstruction(text) {
  if (!text.trim()) throw new Error('Type a Lisp program or choose a command');
  const modules = resolveModules({ ...sources, 'commands/instruction.lisp': text }, [
    'commands/instruction.lisp',
  ]);
  for (const module of modules) runtime.load(cpuForms(module.forms));
  dirty = true;
  report('Instruction executed');
}
const asDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read resource'));
    reader.readAsDataURL(blob);
  });
async function storeGenerated(path, blob, shouldDownload) {
  path = resolvePath(path);
  if (sourceKey(path) in sources) throw new Error('A source file already uses that path');
  if (blob.size > 6000000) throw new Error('Resource exceeds 6MB');
  if (!(path in resources) && Object.keys(resources).length >= 256)
    throw new Error('Maximum 256 assets');
  resources[path] = { mime: blob.type, data: await asDataURL(blob) };
  const persisted = save();
  if (shouldDownload) download(blob, blob.type, path.split('/').at(-1));
  if (persisted) report(`Saved ${path}${shouldDownload ? ' and downloaded' : ' to project'}`);
}
async function exportGeneratedImage(path, shouldDownload) {
  if (!gpu || !lastDraw) throw new Error('WebGPU is unavailable');
  // Submit current GUI parameters before reading back, even between frames.
  gpu.draw(lastDraw, time, state);
  await storeGenerated(path, await gpu.snapshot(true), shouldDownload);
}
async function exportGeneratedSound(path, shouldDownload) {
  refreshAudio();
  await storeGenerated(
    path,
    new Blob([wav(generatedSound)], { type: 'audio/wav' }),
    shouldDownload,
  );
}

// Hidden accessibility mirrors never paint the editor. Lisp regions define them.
let accessibilitySignature = '';
function accessibility() {
  const current = regions.filter((r) => !['source', 'world'].includes(r.id)),
    signature = JSON.stringify(current);
  if (signature === accessibilitySignature) {
    $('accessibility')
      .querySelectorAll('input[data-key]')
      .forEach((input) => (input.value = state[input.dataset.key]));
    return;
  }
  accessibilitySignature = signature;
  $('accessibility').replaceChildren();
  for (const r of current) {
    let control;
    if (r.key) {
      control = document.createElement('input');
      control.type = 'range';
      control.min = r.low;
      control.max = r.high;
      control.step = r.high - r.low <= 2 ? 0.01 : 1;
      control.value = state[r.key];
      control.dataset.key = r.key;
      control.setAttribute('aria-label', r.label);
      control.oninput = () => {
        state[r.key] = Number(control.value);
        dirty = true;
      };
    } else {
      control = document.createElement('button');
      control.textContent = r.label;
      control.onclick = () => activations.add(r.id);
      if (r.menuItem) {
        control.disabled = r.disabled;
        control.setAttribute(
          'role',
          typeof r.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem',
        );
        if (typeof r.checked === 'boolean') control.setAttribute('aria-checked', String(r.checked));
      }
    }
    control.dataset.region = r.id;
    control.onfocus = () => {
      code.focus = 'ui';
      keys.clear();
    };
    $('accessibility').append(control);
  }
}
// Clamp to the visible viewport after collapse, delete, resize or import.
function treeOffset(target) {
  const capacity = Math.min(64, Math.max(1, Math.floor((innerHeight - 125) / 26)));
  const total = projectTree(resourceRows(), target['open-folders']).length;
  return Math.max(0, Math.min(Math.max(0, total - capacity), target['file-offset'] ?? 0));
}
function openFileContext(row, x, y) {
  if (state.window !== '' || state.menu || (!row?.resourcePath && row?.id !== 'files-tree')) return;
  state['context-path'] = row.resourcePath ?? '';
  state['context-kind'] = row.resourceKind === 'folder' ? 'folder' : row.resourcePath ? 'file' : '';
  if (state['context-kind'] === 'file') state['selected-file'] = row.resourcePath;
  state['context-x'] = x;
  state['context-y'] = y;
  state['file-context'] = true;
  code.focus = 'ui';
  keys.clear();
  canvas.focus({ preventScroll: true });
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (e.button === 2) {
    openFileContext(topRegion(pointer.x, pointer.y), pointer.x, pointer.y);
    return;
  }
  if (e.button !== 0) return;
  pointer.down = true;
  pointer.pressed = true;
  pointer.target = topRegion(pointer.x, pointer.y);
  canvas.setPointerCapture(e.pointerId);
  if (pointer.target?.id === 'source') code.pointer(pointer.x, pointer.y);
  else {
    code.focus = pointer.target?.id === 'world' ? 'world' : 'ui';
    canvas.focus({ preventScroll: true });
    keys.clear();
  }
  if (pointer.target?.id === 'world') activateAudio().catch(() => {});
});
canvas.addEventListener('pointermove', (e) => {
  pointer.moved = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (pointer.down && code.drag) code.pointer(pointer.x, pointer.y, true);
});
const release = () => {
  pointer.down = false;
  pointer.capture = null;
  pointer.target = null;
  code.drag = false;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener(
  'wheel',
  (e) => {
    const tree = regions.find((region) => region.id === 'files-tree');
    if (
      state.window === '' &&
      !state.menu &&
      !state['file-context'] &&
      tree &&
      inBox(e.clientX, e.clientY, tree.origin, tree.size)
    ) {
      e.preventDefault();
      const rows = Math.min(64, Math.max(1, Math.floor(tree.size[1] / 26)));
      const count = projectTree(resourceRows(), state['open-folders']).length;
      state['file-offset'] = Math.max(
        0,
        Math.min(Math.max(0, count - rows), (state['file-offset'] ?? 0) + Math.sign(e.deltaY) * 3),
      );
      dirty = true;
      return;
    }
    const r = topRegion(e.clientX, e.clientY);
    if (r?.id === 'source') {
      e.preventDefault();
      code.wheel(e.deltaY || e.deltaX, e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY));
    }
  },
  { passive: false },
);
function enterRecovery() {
  recovery = true;
  editorFailed = false;
  state.tab = 'editor';
  state['show-code'] = true;
  state['show-tools'] = false;
  state['file-path-editing'] = false;
  state.menu = false;
  state.window = '';
  dirty = true;
  report('Recovery shell. Adopt the latest editor or edit its sources and run.');
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['s', 'o'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    state.menu = false;
    if (e.key.toLowerCase() === 'o') $('file-input').click();
    else
      download(
        JSON.stringify(projectSnapshot(sources, state, resources, recovery), null, 2),
        'application/json',
        'midnight-garden.aioli.json',
      );
    return;
  }
  const menus = ['file', 'project', 'view', 'edit', 'about'];
  if (e.altKey && ['f', 'p', 'v', 'e', 'a'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    state['file-context'] = false;
    state['context-kind'] = '';
    state.menu = menus[['f', 'p', 'v', 'e', 'a'].indexOf(e.key.toLowerCase())];
    keys.clear();
    canvas.focus();
    return;
  }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    const row =
      regions.find((r) => r.resourcePath === state['selected-file']) ||
      regions.find((r) => r.id === 'files-tree');
    if (row) {
      e.preventDefault();
      openFileContext(row, row.origin[0] + 40, row.origin[1] + 20);
    }
    return;
  }
  if (typeof state.menu === 'string' || state['file-context']) {
    if (e.key === 'Escape') {
      e.preventDefault();
      state.menu = false;
      state['file-context'] = false;
      canvas.focus();
      return;
    }
    if (!state['file-context'] && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      state.menu = menus[(menus.indexOf(state.menu) + (e.key === 'ArrowRight' ? 1 : 4)) % 5];
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const controls = [
        ...$('accessibility').querySelectorAll('[role^="menuitem"]:not(:disabled)'),
      ];
      const index = controls.indexOf(document.activeElement);
      const next =
        index < 0
          ? e.key === 'ArrowDown'
            ? 0
            : controls.length - 1
          : (index + (e.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length;
      controls[next]?.focus();
      return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    state.window = state.window === 'palette' ? '' : 'palette';
    sources.__palette = '';
    keys.clear();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(timer);
    if (state.window === 'palette') defer(() => runInstruction(sources.__palette));
    else evaluate();
    return;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    enterRecovery();
    return;
  }
  if (e.key === 'Escape') {
    state['file-path-editing'] = false;
    state.window = '';
    state.menu = false;
    state['show-tools'] = false;
    keys.clear();
    return;
  }
  if (code.focus === 'world') {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'w', 'a', 'd'].includes(key)) {
      e.preventDefault();
      keys.add(key);
      activateAudio().catch(() => {});
    }
  }
});
document.addEventListener('keyup', (e) =>
  keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key),
);
window.addEventListener('blur', () => {
  keys.clear();
  release();
});
$('file-input').onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 16000000) throw new Error('Project exceeds 16MB');
    const project = JSON.parse(await file.text());
    await evaluate({ imported: validateProject(project) });
  } catch (error) {
    report(error.message, true);
  } finally {
    e.target.value = '';
  }
};
$('resource-input').onchange = async (event) => {
  try {
    for (const file of event.target.files) {
      const path = resolvePath(`assets/${file.name}`);
      if (sourceKey(path) in sources || path in resources)
        throw new Error(`File already exists: ${path}`);
      if (file.size > 6000000) throw new Error('Resource exceeds 6MB');
      if (path.endsWith('.lisp')) {
        if (Object.keys(sources).filter((key) => !key.startsWith('__')).length >= 256)
          throw new Error('Maximum 256 source files');
        const text = await file.text();
        if (text.length > 100000) throw new Error('Source exceeds 100KB');
        sources[path] = text;
      } else {
        if (Object.keys(resources).length >= 256) throw new Error('Maximum 256 assets');
        if (!/^(image|audio)\//.test(file.type))
          throw new Error('Import a Lisp, image or audio file');
        resources[path] = { mime: file.type, data: await asDataURL(file) };
      }
    }
    await evaluate();
  } catch (error) {
    report(error.message, true);
  } finally {
    event.target.value = '';
  }
};

function frame(now) {
  // Gameplay may pause/fail independently. Keep the editor available for repairs.
  const dt = Math.min((now - lastFrame) / 1000, 0.04);
  lastFrame = now;
  if (runtime) {
    try {
      if (!state.paused && !gameFailed) {
        time += dt;
        runtime.call('update', dt);
        if (typeof runtime.global['scene-update'] === 'function') runtime.call('scene-update', dt);
      }
    } catch (e) {
      gameFailed = true;
      report(`Gameplay: ${e.message}`, true);
    }
    try {
      if (now - lastAudio > 180) {
        refreshAudio();
        lastAudio = now;
      }
    } catch (e) {
      report(`Sound: ${e.message}`, true);
    }
    try {
      const ui = recovery || editorFailed ? rescueRuntime : runtime;
      if (state.window !== visibleWindow) {
        visibleWindow = state.window;
        focusPalette = visibleWindow === 'palette';
        focusPath = visibleWindow === 'file-path';
      }
      const result = ui.drawEditor();
      lastDraw = result.draw;
      regions = result.regions;
      accessibility();
    } catch (e) {
      editorFailed = true;
      report(`Editor: ${e.message}. Press F2 for recovery.`, true);
    }
    try {
      if (gpu && lastDraw) gpu.draw(lastDraw, time, state);
    } catch (e) {
      report(`Drawing: ${e.message}`, true);
    }
    if (pointer.pressed || pointer.down || activations.size || keys.size) dirty = true;
    if (dirty && now - lastSave > 1000) {
      save();
      lastSave = now;
    }
  }
  // Immediate-mode edge events live for exactly one editor frame.
  pointer.pressed = false;
  pointer.moved = false;
  activations.clear();
  requestAnimationFrame(frame);
}
try {
  gpu = await GPUHost.create(canvas, (e, fatal) => {
    const text = `WebGPU: ${e}`;
    if (fatal) gpuFailure = text;
    report(text, true);
  });
} catch (e) {
  gpuFailure = e.message;
  $('startup').hidden = false;
  $('startup').textContent = e.message;
  report(e.message, true);
}
await evaluate();
if (!runtime) {
  const failedSources = { ...sources },
    failure = message;
  await evaluate({ imported: { sources: defaults, state: {}, resources } });
  Object.assign(sources, failedSources);
  recovery = true;
  state.tab = 'editor';
  report(`Opened recovery shell: ${failure}`, true);
}
requestAnimationFrame(frame);
// Read-only snapshots for integration checks, not a second editor control API.
window.aioli = {
  get state() {
    return { ...state };
  },
  get shader() {
    return compiled?.code;
  },
  get primitives() {
    return compiled?.primitives;
  },
  get running() {
    return Boolean(gpu?.scenePipeline) && !gameFailed && !editorFailed && !gpuFailure;
  },
  get regions() {
    return regions.map((r) => ({ ...r }));
  },
  get commands() {
    return lastDraw?.commands;
  },
  get error() {
    return error;
  },
  get pending() {
    return pending;
  },
  get status() {
    return message;
  },
  get sources() {
    return { ...sources };
  },
  get resources() {
    return structuredClone(resources);
  },
  get recovery() {
    return recovery;
  },
};

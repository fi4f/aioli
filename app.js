import { pixelBlock } from './pixel-block.js';
import { canvasSize } from './canvas-size.js';
import { textOutput, textMime } from './text-generator.js';
import { newFilePath, newFileCode } from './file-templates.js';
import {
  savedFolders,
  folderPaths,
  validateFolderPath,
  planFolderMove,
  filePaths,
  insideFolder,
} from './folder-operations.js';
import { sourceHooks } from './hook-definitions.js';
import { previewHook } from './hook-preview.js';
import { inspectorFields, liveFields, fieldRow, referencedStateKeys } from './inspector-fields.js';
import { launchApplication } from './application.js';
import { engineServices } from './engine-services.js';
import { applicationFiles } from './application-files.js';
import { exportHTML } from './html-export.js';
import { parse, createRuntime } from './lisp.js';
import { compileShader } from './shader.js';
import { exampleScenePaths } from './example-sources.js';
import { validateVoice, synthesize, wav } from './audio.js';
import { DrawList } from './drawing.js';
import { GPUHost } from './gpu.js';
import { loadBundledResources } from './bundled-assets.js';
import { ResourceIcons } from './resource-icons.js';
import { planFileMove } from './file-moves.js';
import { refreshLinkedAssets } from './linked-assets.js';
import { CodeInput } from './code-input.js';
import { editorSourcePaths } from './editor-sources.js';
import { openTab, closeTab, renameTab, tabLayout } from './code-tabs.js';
import { AssetPreview } from './asset-preview.js';
import { stageScene, callHook, callLifecycle, isScenePath, selectScene } from './scenes.js';
import { normalizeSource, displaySource } from './source-text.js';
import { assetKind, isCommandFile, projectTree, toggleFolder } from './file-tree.js';
import { generatorSources } from './generators.js';
import { stageGenerators, fieldValue } from './generator-inspector.js';
import { sourceRole } from './source-roles.js';
import {
  rolePath,
  sourcePath,
  sourceKey,
  resolvePath,
  resolveModules,
  cpuForms,
  pixelHook,
  projectSnapshot,
  readProject,
} from './project.js';

const bundledResources = await loadBundledResources();
const resourceIcons = new ResourceIcons((images) => gpu?.setIcons(images));

/** Browser services for the Lisp editor; appearance and layout stay in Lisp. */
const $ = (id) => document.getElementById(id),
  canvas = $('app'),
  // Retain the storage key so earlier local projects migrate in place.
  storageKey = 'aioli.project.v3';
// Resolve against this module, not the domain root, for GitHub Pages subpaths.
async function loadBundledSource(filename) {
  const response = await fetch(new URL(filename, import.meta.url));
  if (!response.ok) throw new Error(`Unable to load ${filename}: HTTP ${response.status}`);
  return normalizeSource(await response.text());
}
const defaults = {
  ...Object.fromEntries(
    await Promise.all(exampleScenePaths.map(async (path) => [path, await loadBundledSource(path)])),
  ),
  game: await loadBundledSource('game.lisp'),
  main: await loadBundledSource('main.lisp'),
  ...generatorSources,
  ...Object.fromEntries(
    await Promise.all(editorSourcePaths.map(async (path) => [path, await loadBundledSource(path)])),
  ),
};
const sources = Object.assign(Object.create(null), defaults);
let resources = Object.assign(Object.create(null), bundledResources),
  generatedSound;
let generatorPrograms = [],
  sceneFields = [],
  sceneStateKeys = new Set();
let sceneColorKey = null;
const selectedGenerator = (programs, target) =>
  programs.find((program) => program.path === target['active-generator']) ?? programs[0];
const outputGenerator = (programs, target, output) => {
  const selected = selectedGenerator(programs, target);
  return selected?.output === output
    ? selected
    : (programs.find((program) => program.path === target[`${output}-generator-path`]) ??
        programs.find((program) => program.output === output));
};
const transientBuffers = {
  __palette: '',
  __path: 'lib/new.lisp',
  __hookArgs: '[]',
  __canvasSize: '320 240',
};
Object.assign(sources, transientBuffers);
const resourceRows = (sourceStore = sources, resourceStore = resources) => [
  ...Object.keys(sourceStore)
    .filter((key) => !key.startsWith('__'))
    .map((key) => [sourcePath(key), 'lisp', key]),
  ...Object.keys(resourceStore).map((path) => [path, 'asset', path, resourceStore[path].mime]),
];
let state = Object.create(null),
  runtime,
  gameRuntime,
  applicationState = Object.create(null),
  activeScene = null,
  sceneTime = 0,
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
Edit main.lisp for editor layout and behavior.
Edit game.lisp for the embedded application.
Edit editor/ui/components.lisp for button and slider implementations.
Every visible element is a WebGPU pixel primitive.

Ctrl/Cmd+Enter  Evaluate all programs
F2             Recover the editor shell
F4             Focus preview / restore editor
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
  (code-editor [16 100] [500 600] :main)
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

Widgets in editor/ui/components.lisp are ordinary Lisp functions.
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
  return readProject(project, defaults, bundledResources);
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
    for (const key of Object.keys(sources)) if (!key.startsWith('__')) delete sources[key];
    Object.assign(sources, project.sources);
    resources = project.resources;
    recovery = project.recovery;
    state = Object.assign(Object.create(null), project.state);
    applicationState = Object.assign(Object.create(null), project.applicationState);
  }
} catch {}
committedSources = { ...sources };
let refreshingAssets = false;
async function refreshAssetsFromDisk() {
  if (refreshingAssets || pending) return;
  refreshingAssets = true;
  const current = resources;
  try {
    if ((await refreshLinkedAssets(current)) && resources === current) {
      dirty = true;
    }
  } finally {
    refreshingAssets = false;
  }
}
await refreshAssetsFromDisk();
setInterval(() => {
  if (!document.hidden) void refreshAssetsFromDisk();
}, 1500);
window.addEventListener('focus', () => void refreshAssetsFromDisk());

let hookPreview = null;
async function inspectHook(path, name, args) {
  const stores = applicationFiles(sources, state['editor-owned-files']);
  const files = path in stores.game ? stores.game : stores.editor;
  const result = previewHook({
    files,
    path,
    name,
    state: path in stores.game ? applicationState : state,
    args,
    entry: path in stores.game ? 'game.lisp' : undefined,
    resource: (path) => resources[resolvePath(path)]?.data ?? '',
  });
  if (result.pcm)
    result.resource = {
      mime: 'audio/wav',
      data: await asDataURL(new Blob([wav(result.pcm)], { type: 'audio/wav' })),
    };
  hookPreview = result;
  sources.__hookArgs = JSON.stringify(result.args);
  code.forgetBuffer('__hookArgs');
  if (result.kind === 'draw' && gpu) await gpu.preparePixels(result.draw);
  if (result.kind === 'sound') {
    state['preview-path'] = `Sound hook / ${result.title}`;
    await assetPreview.open(state['preview-path'], result.resource, 'audio');
    state.window = 'hook-sound';
  } else state.window = 'hook-draw';
  report(`Preview / ${result.title}`);
}

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
      JSON.stringify(
        projectSnapshot(committedSources, state, resources, recovery, applicationState),
      ),
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
  return regions.findLast(
    (r) =>
      inBox(x, y, r.origin, r.size) &&
      (!r.clip || inBox(x, y, r.clip.slice(0, 2), r.clip.slice(2))),
  );
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
  if (state['auto-evaluate'] !== false)
    timer = setTimeout(() => {
      if (state['auto-evaluate'] !== false) evaluate();
    }, 500);
  else report('Edits pending / Ctrl+Enter to run');
});

const assetPreview = new AssetPreview(
  () => gpu,
  () => (audioContext ??= new AudioContext()),
);
function previewAsset(path) {
  const resource = resources[path];
  const kind = assetKind(path, 'asset', resource?.mime);
  if (
    resource &&
    (/^text\//.test(resource.mime) || /^application\/(json|xml)(;|$)/.test(resource.mime))
  ) {
    const encoded = resource.data.slice(resource.data.indexOf(',') + 1);
    sources.__textResource = new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    );
    state['preview-path'] = path;
    state.window = 'text-asset';
    code.forgetBuffer('__textResource');
    return;
  }
  if (kind !== 'image' && kind !== 'audio') {
    report(`${path} • ${resource?.mime ?? 'asset'}`);
    return;
  }
  state['preview-path'] = path;
  state['preview-zoom'] = 1;
  state['preview-pan-x'] = state['preview-pan-y'] = 0;
  state.window = kind + '-asset';
  return assetPreview.open(path, resource, kind);
}

/**
 * Bind native services to one candidate's state. Validation candidates cannot
 * consume input or perform file/audio actions; only the active/recovery editor can.
 */
function makeRuntime(target, candidateSources = sources, candidateResources = resources) {
  let draw,
    items = [],
    patch = [],
    buffer = { rows: [], hooks: [], selections: [], caret: null },
    tabs = { rows: [], before: false, after: false };
  const live = () =>
    result === runtime || result === rescueRuntime || result === activeScene?.runtime;
  // Candidate queries must describe the imported/draft project before commit.
  const visibleSources = () => (live() ? sources : candidateSources);
  const visibleResources = () => (live() ? resources : candidateResources);
  const rowsForTarget = () => resourceRows(visibleSources(), visibleResources());
  const actions =
    (fn) =>
    (...args) => {
      if (live()) defer(() => fn(...args));
      else if (result.captureActions) result.pendingActions.push(() => fn(...args));
    };
  const result = createRuntime(target, {
    budget: 100000,
    key: (k) => code.focus === 'world' && keys.has(k),
    pixels: (args, env, evaluate) => {
      if (!draw) throw new Error('pixels requires a draw hook');
      draw.pixels(pixelBlock(args, env, evaluate, target));
    },
    beginScope: () => draw?.scope(),
    endScope: () => draw?.restore(),
    voice: (...args) => {
      if (patch.length >= 16) throw new Error('Maximum 16 voices');
      patch.push(validateVoice(...args));
    },
    playSound: (name = 'sound', ...args) => {
      if (live()) {
        try {
          const pcm =
            name === 'sound'
              ? (refreshAudio(), samples)
              : synthesize(result.collectSound(name, ...args));
          playSamples(pcm).catch((e) => report(e.message, true));
        } catch (e) {
          report(e.message, true);
        }
      }
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
      'game-definitions': () =>
        Object.keys((result.gameRuntime ?? gameRuntime)?.global ?? {}).sort(),
      'game-call': (name, ...args) =>
        (result.gameRuntime ?? gameRuntime).call(name, ...structuredClone(args)),
      'game-state': () => Object.entries(result.applicationState ?? applicationState),
      'game-code': (path) => visibleSources()[sourceKey(resolvePath(path))] ?? '',
      'game-get': (key) => result.applicationState?.[key] ?? applicationState[key],
      'game-set!': (key, value) => {
        if (
          !['number', 'string', 'boolean'].includes(typeof value) ||
          (typeof value === 'number' && !Number.isFinite(value))
        )
          throw new Error('Invalid game state');
        (result.applicationState ?? applicationState)[key] = value;
      },
      'canvas-width': () => canvasSize(target)[0],
      'canvas-height': () => canvasSize(target)[1],
      'open-canvas-settings': actions(() => {
        const [w, h] = canvasSize(state);
        sources.__canvasSize = `${w} ${h}`;
        code.forgetBuffer('__canvasSize');
        state.window = 'canvas-settings';
        state.menu = false;
      }),
      'canvas-preset': actions((w, h) => {
        sources.__canvasSize = `${w} ${h}`;
        code.forgetBuffer('__canvasSize');
      }),
      'apply-canvas-settings': actions(async () => {
        const dimensions = sources.__canvasSize
          .trim()
          .split(/[x,\s]+/i)
          .map(Number);
        if (dimensions.length !== 2)
          throw new Error('Enter canvas width and height, for example 640 360');
        const settings = {
          ...state,
          'canvas-width': dimensions[0],
          'canvas-height': dimensions[1],
        };
        canvasSize(settings);
        const previous = [state['canvas-width'], state['canvas-height']];
        state['canvas-width'] = settings['canvas-width'];
        state['canvas-height'] = settings['canvas-height'];
        if (await evaluate()) {
          state.window = '';
          save();
        } else {
          [state['canvas-width'], state['canvas-height']] = previous;
        }
      }),
      'screen-width': () => innerWidth,
      'screen-height': () => innerHeight,
      'edit-buffer': actions((action) => code.edit(action)),
      'can-edit-buffer?': (action) => code.canEdit(action),
      'toggle-auto-evaluate': actions(() => {
        state['auto-evaluate'] = state['auto-evaluate'] === false;
        clearTimeout(timer);
        dirty = true;
        if (
          state['auto-evaluate'] &&
          Object.entries(sources).some(
            ([key, text]) => !key.startsWith('__') && text !== committedSources[key],
          )
        )
          runProject();
      }),
      'prepare-folder-path': actions((operation = 'create') => {
        const path = state['context-path'] ?? '';
        const parent =
          state['context-kind'] === 'folder'
            ? path + '/'
            : path.slice(0, path.lastIndexOf('/') + 1);
        sources.__path = operation === 'create' ? parent + 'new-folder' : path;
        state['folder-source'] = path;
        state['file-operation'] = 'folder-' + operation;
        state['file-context'] = false;
        state.window = 'file-path';
        state['file-path-editing'] = false;
      }),
      'apply-folder-path': actions((path) =>
        state['file-operation'] === 'folder-create'
          ? createProjectFolder(path)
          : moveProjectFolder(state['folder-source'], path),
      ),
      'folder-file-count': (path) =>
        filePaths(visibleSources(), visibleResources()).filter((file) => insideFolder(file, path))
          .length,
      'delete-folder': actions((path) => deleteProjectFolder(path)),
      'prepare-file-path': actions((rename = false) => {
        const contextPath = state['context-path'] ?? '';
        const folder =
          state['context-kind'] === 'folder'
            ? contextPath + '/'
            : state['context-kind'] === 'file'
              ? contextPath.slice(0, contextPath.lastIndexOf('/') + 1)
              : '';
        sources.__path = rename ? state['selected-file'] : folder + 'new.lisp';
        state['file-operation'] = rename ? 'rename' : 'create';
        if (!rename) {
          state['new-file-type'] = 'script';
          state['new-generator-output'] = 'image';
        }
        state['file-path-editing'] = false;
        state['file-context'] = false;
        state.window = 'file-path';
      }),
      // During staging this selects the initial scene; live calls request a
      // transactional transition. The previous scene survives rejected edits.
      'start-scene': (path = '') => {
        path = path ? resolvePath(path) : '';
        if (live()) defer(() => evaluate({ scene: path }));
        else result.initialScene = path;
      },
      'active-scene': () => (result.applicationState ?? applicationState)['active-scene'] ?? '',
      'playable-file?': (path) =>
        (['main.lisp', 'game.lisp'].includes(path) || isScenePath(path)) &&
        sourceKey(path) in visibleSources(),
      'play-file': actions(async (path) => {
        path = resolvePath(path);
        if (path === 'main.lisp') return runProject();
        if (path !== 'game.lisp' && !isScenePath(path))
          throw new Error('Expected game.lisp or a scene file');
        if (await evaluate(path === 'game.lisp' ? { restart: true } : { scene: path })) {
          state.paused = false;
          state['file-context'] = false;
          dirty = true;
        }
      }),
      'icon-available?': (path) => resourceIcons.index(resolvePath(path), visibleResources()) >= 0,
      icon: (path, origin, size) => {
        const index = resourceIcons.index(resolvePath(path), visibleResources());
        if (index < 0) throw new Error(`Image mask is not ready: ${path}`);
        draw.emit(
          7,
          [...draw.point(origin), ...size.map((v) => v * draw.state.scale)],
          [index, 0, 0, 0],
        );
      },
      'toggle-preview-focus': actions(() => togglePreviewFocus()),
      'preview-path': () =>
        (result.applicationState ?? applicationState)['active-scene'] || 'game.lisp',
      'scene-fields': () =>
        liveFields(
          result.sceneFields ?? sceneFields,
          result.applicationState ?? applicationState,
          result.sceneStateKeys ?? sceneStateKeys,
        ).map(fieldRow),
      'scene-field-value': (key) => (result.applicationState ?? applicationState)[key],
      'set-scene-field': (key, value) => {
        const data = result.applicationState ?? applicationState;
        const field = liveFields(
          result.sceneFields ?? sceneFields,
          data,
          result.sceneStateKeys ?? sceneStateKeys,
        ).find((field) => field.key === key);
        if (!field) throw new Error('Unknown scene field');
        data[key] = fieldValue(field, value);
        dirty = true;
      },
      'scene-field-step': (key) => {
        const field = liveFields(
          result.sceneFields ?? sceneFields,
          result.applicationState ?? applicationState,
          result.sceneStateKeys ?? sceneStateKeys,
        ).find((field) => field.key === key);
        const region = items.findLast((region) => region.key === '__scene-' + key);
        if (region && field) region.step = field.step;
      },
      'scene-edit-kind': () =>
        liveFields(
          result.sceneFields ?? sceneFields,
          result.applicationState ?? applicationState,
          result.sceneStateKeys ?? sceneStateKeys,
        ).find((field) => field.key === target['scene-edit-key'])?.kind ?? '',
      'edit-scene-field': actions((key) => {
        const field = liveFields(sceneFields, applicationState, sceneStateKeys).find(
          (field) => field.key === key,
        );
        if (!field) throw new Error('Unknown scene field');
        state['scene-edit-key'] = key;
        sources.__sceneValue = String(applicationState[key]);
        code.forgetBuffer('__sceneValue');
        if (field.kind === 'color') {
          sceneColorKey = key;
          const input = $('generator-color');
          input.value = applicationState[key];
          input.click();
        }
      }),
      'apply-scene-field': actions(() => {
        const field = liveFields(sceneFields, applicationState, sceneStateKeys).find(
          (field) => field.key === state['scene-edit-key'],
        );
        if (field) applicationState[field.key] = fieldValue(field, sources.__sceneValue);
        state['scene-edit-key'] = '';
        dirty = true;
      }),
      'command-file?': (path) => isCommandFile(path) && sourceKey(path) in visibleSources(),
      'selected-file?': () =>
        sourceKey(target['selected-file'] ?? '') in sources ||
        (target['selected-file'] ?? '') in resources,
      'selected-file-renamable?': () =>
        !['main.lisp', 'game.lisp'].includes(target['selected-file']) &&
        (sourceKey(target['selected-file'] ?? '') in sources ||
          target['selected-file'] in resources),
      'selected-file-removable?': () =>
        !['main.lisp', 'game.lisp'].includes(target['selected-file']) &&
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
      'project-tree-offset': (capacity) => treeOffset(target, rowsForTarget(), capacity),
      'project-tree-width': () =>
        Math.max(
          0,
          ...projectTree(
            rowsForTarget(),
            target['open-folders'],
            savedFolders(target['project-folders']),
          ).map(
            (row) =>
              row[4] * 14 +
              (isCommandFile(row[0]) ||
              ['main.lisp', 'game.lisp'].includes(row[0]) ||
              isScenePath(row[0])
                ? 58
                : 36) +
              displaySource(row[3]).length * 8 +
              8,
          ),
        ),
      'project-tree': (capacity) =>
        projectTree(
          rowsForTarget(),
          target['open-folders'],
          savedFolders(target['project-folders']),
        ).slice(
          treeOffset(target, rowsForTarget(), capacity),
          treeOffset(target, rowsForTarget(), capacity) + 64,
        ),
      'project-tree-count': () =>
        projectTree(
          rowsForTarget(),
          target['open-folders'],
          savedFolders(target['project-folders']),
        ).length,
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
      'open-code-tab': actions((key) => {
        openTab(state, sources, key);
        dirty = true;
      }),
      'close-code-tab': actions((key) => {
        closeTab(state, sources, key);
        dirty = true;
      }),
      'scroll-code-tabs': actions((delta) => {
        state['tab-offset'] = Math.max(0, (state['tab-offset'] ?? 0) + delta);
      }),
      'code-tabs': (width) => {
        tabs = tabLayout(target, visibleSources(), committedSources, width);
        return tabs.rows;
      },
      'code-tabs-before?': () => tabs.before,
      'code-tabs-after?': () => tabs.after,
      'active-code-path': () => sourcePath(target.tab ?? ''),
      'source-hooks': () => {
        try {
          return sourceHooks(
            parse(
              visibleSources()[
                sourceKey(
                  target.window === 'hooks' ? target['hook-path'] : sourcePath(target.tab ?? ''),
                )
              ] ?? '',
            ),
          ).map((h) => [h.name, h.kind, h.title]);
        } catch {
          return [];
        }
      },
      'open-hooks': actions(() => {
        state['hook-path'] = sourcePath(state.tab);
        state['hook-offset'] = 0;
        state.window = 'hooks';
      }),
      'inspect-hook': actions((name) => inspectHook(state['hook-path'], name)),
      'hook-title': () => hookPreview?.title ?? 'Source hooks',
      'hook-parameters': () => hookPreview?.params.join(', ') ?? '',
      'hook-draw-preview': (origin, size) => {
        if (hookPreview?.draw) {
          const canvas = hookPreview.draw;
          const scale = Math.min(size[0] / canvas.width, size[1] / canvas.height);
          draw.composite(
            canvas,
            [
              origin[0] + (size[0] - canvas.width * scale) / 2,
              origin[1] + (size[1] - canvas.height * scale) / 2,
            ],
            [canvas.width * scale, canvas.height * scale],
          );
        }
      },
      'refresh-hook-preview': actions(() =>
        inspectHook(hookPreview.path, hookPreview.name, JSON.parse(sources.__hookArgs)),
      ),
      'back-to-hooks': actions(() => {
        assetPreview.close();
        state.window = '';
      }),

      'open-file': actions((path) => {
        path = resolvePath(path);
        const key = sourceKey(path);
        if (key in sources) {
          if (sourceRole(path) === 'generator')
            return evaluateGeneratorSelection(path).then((ok) => {
              if (ok) {
                state.window = 'generator';
                state['selected-file'] = path;
                state['inspector-offset'] = 0;
                state['text-preview-offset'] = state['text-preview-x'] = 0;
              }
            });
          openTab(state, sources, key);
          state['show-code'] = true;
          if (innerWidth < (state['ui-narrow-width'] ?? 850)) state['show-files'] = false;
          state['file-path-editing'] = false;
          state['selected-file'] = path;
          state.window = '';
        } else if (resources[path]) {
          state['selected-file'] = path;
          return previewAsset(path);
        } else throw new Error(`Missing file ${path}`);
      }),
      'new-file-path': newFilePath,
      'new-file-code': newFileCode,
      'create-file': actions((path, text = '; New project module\n') => {
        path = resolvePath(path);
        assertFileDestination(path);
        if (path.startsWith('__'))
          throw new Error('Names beginning with __ are reserved for input buffers');
        const key = sourceKey(path);
        if (key in sources || path in resources) throw new Error(`File already exists: ${path}`);
        if (Object.keys(sources).length >= 258) throw new Error('Maximum 256 source files');
        if (typeof text !== 'string' || text.length > 100000)
          throw new Error('Invalid source text');
        sources[key] = normalizeSource(text);
        openTab(state, sources, key);
        state['show-code'] = true;
        if (innerWidth < (state['ui-narrow-width'] ?? 850)) state['show-files'] = false;
        state['file-path-editing'] = false;
        state['selected-file'] = path;
        state.window = '';
        evaluate();
      }),
      'rename-file': actions((oldPath, newPath) => {
        oldPath = resolvePath(oldPath);
        newPath = resolvePath(newPath);
        assertFileDestination(newPath);
        if (newPath.startsWith('__'))
          throw new Error('Names beginning with __ are reserved for input buffers');
        if (['main.lisp', 'game.lisp'].includes(oldPath))
          throw new Error('Keep the application entry filenames');
        const oldKey = sourceKey(oldPath),
          newKey = sourceKey(newPath);
        if (newKey in sources || newPath in resources)
          throw new Error('Destination already exists');
        if (oldKey in sources) {
          if (!newPath.endsWith('.lisp') && !isScenePath(newPath))
            throw new Error('Source files must end in .lisp');
          sources[newKey] = sources[oldKey];
          delete sources[oldKey];
          renameTab(state, sources, oldKey, newKey);
          code.renameBuffer(oldKey, newKey);
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
        if (['main.lisp', 'game.lisp'].includes(path))
          throw new Error('main.lisp and game.lisp cannot be deleted');
        const key = sourceKey(path);
        closeTab(state, sources, key);
        code.forgetBuffer(key);
        delete sources[key];
        delete resources[path];
        evaluate();
      }),
      'new-project': actions(async () => {
        const freshResources = await loadBundledResources();
        try {
          localStorage.setItem(
            'aioli.project.previous',
            JSON.stringify(projectSnapshot(sources, state, resources, recovery, applicationState)),
          );
        } catch {}
        if (
          await evaluate({
            imported: {
              sources: { ...defaults },
              resources: freshResources,
              state: {
                'show-files': true,
                'open-folders': '["examples"]',
                tab: 'game',
                'selected-file': 'game.lisp',
              },
              applicationState: {},
              recovery: false,
            },
          })
        ) {
          code.sessions.clear();
          code.history.clear();
          code.tab = '';
          keys.clear();
          report('New project / examples/garden.scene.lisp');
        }
      }),
      'open-external-file': actions(() => $('open-file-input').click()),
      'save-file?': () => !!saveFilePath(),
      'save-file': actions(() => downloadFile(saveFilePath())),
      'file-drag-path': () => (fileDrag?.active ? fileDrag.path : ''),
      'file-drop-target?': (path) => !!fileDrag?.active && fileDrag.folder === path,
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
      'generator-files': () =>
        Object.keys(visibleSources())
          .map(sourcePath)
          .filter((path) => sourceRole(path) === 'generator')
          .sort(),
      'generator-path': () =>
        selectedGenerator(result.generators ?? generatorPrograms, target)?.path ?? '',
      'generator-title': () =>
        selectedGenerator(result.generators ?? generatorPrograms, target)?.title ?? 'Generators',
      'generator-edit-kind': () =>
        selectedGenerator(result.generators ?? generatorPrograms, target)?.fields.find(
          (field) => field.key === target['inspector-edit-key'],
        )?.kind ?? '',
      'generator-output': () =>
        selectedGenerator(result.generators ?? generatorPrograms, target)?.output ?? '',
      'generator-text': () =>
        textOutput(selectedGenerator(result.generators ?? generatorPrograms, target)).text,
      'generator-text-error': () =>
        textOutput(selectedGenerator(result.generators ?? generatorPrograms, target)).error,
      'generator-text-line-count': () =>
        textOutput(selectedGenerator(result.generators ?? generatorPrograms, target)).lines.length,
      'generator-filename': () =>
        selectedGenerator(result.generators ?? generatorPrograms, target)?.filename ??
        'generated.txt',
      'generate-text-preview': actions(() => {
        textOutput(selectedGenerator(generatorPrograms, state), true);
        dirty = true;
      }),
      'text-preview': (origin, size) => {
        const output = textOutput(
          selectedGenerator(result.generators ?? generatorPrograms, target),
        );
        const lines = output.lines;
        const offset = target['text-preview-offset'] ?? 0;
        const first = Math.floor(offset / 18);
        draw.scope();
        draw.clip(origin, size);
        draw.fill(output.error ? target['ui-error'] : target['ui-text']);
        for (let i = first; i < Math.min(lines.length, first + Math.ceil(size[1] / 18) + 1); i++)
          draw.text(
            [origin[0] + 4 - ((target['text-preview-x'] ?? 0) % 8), origin[1] + i * 18 - offset],
            displaySource(
              lines[i].slice(
                Math.floor((target['text-preview-x'] ?? 0) / 8),
                Math.floor((target['text-preview-x'] ?? 0) / 8) + Math.ceil(size[0] / 8) + 1,
              ),
            ),
          );
        draw.restore();
      },
      'export-text': actions(() => exportGeneratedText(true)),
      'save-text-resource': actions(() => exportGeneratedText(false)),
      'generator-fields': () =>
        (selectedGenerator(result.generators ?? generatorPrograms, target)?.fields ?? []).map(
          (field) => [
            field.key,
            field.label,
            field.kind,
            field.low,
            field.high,
            field.step,
            field.choices,
          ],
        ),
      'normalize-generator-field': (key) => {
        const field = selectedGenerator(
          result.generators ?? generatorPrograms,
          target,
        )?.fields.find((field) => field.key === key);
        if (field) {
          target[key] = fieldValue(field, target[key]);
          const region = items.findLast((region) => region.key === key);
          if (region) region.step = field.step;
        }
      },
      'open-generator': actions(async (path) => {
        if (!path) {
          state.window = 'generator';
          return;
        }
        if (sourceRole(path) !== 'generator' || !(sourceKey(path) in sources))
          throw new Error('Expected a .generator.lisp file');
        if (await evaluateGeneratorSelection(path)) {
          state.window = 'generator';
          state['inspector-offset'] = 0;
          state['text-preview-offset'] = state['text-preview-x'] = 0;
        }
      }),
      'edit-generator-field': actions((key) => {
        const field = selectedGenerator(generatorPrograms, state)?.fields.find(
          (field) => field.key === key,
        );
        if (!field) throw new Error('Unknown generator field');
        sceneColorKey = null;
        state['inspector-edit-key'] = key;
        sources.__generatorValue = String(state[key]);
        code.forgetBuffer('__generatorValue');
        if (field.kind === 'color') {
          const input = $('generator-color');
          input.value = state[key];
          input.click();
        }
      }),
      'apply-generator-field': actions(() => {
        const field = selectedGenerator(generatorPrograms, state)?.fields.find(
          (field) => field.key === state['inspector-edit-key'],
        );
        if (field) state[field.key] = fieldValue(field, sources.__generatorValue);
        state['inspector-edit-key'] = '';
        dirty = true;
      }),
      'palette-query': () => sources.__palette,
      'palette-commands': () => {
        const query = sources.__palette.toLowerCase().trim();
        return Object.keys(sources)
          .filter(
            (key) =>
              isCommandFile(sourcePath(key)) && (!query || key.toLowerCase().includes(query)),
          )
          .sort()
          .slice(0, 8);
      },
      'run-command': actions((path) => runCommand(path)),
      'run-instruction': actions(() => runInstruction(sources.__palette)),
      'path-input': () => sources.__path,
      'asset-ready?': () => assetPreview.ready,
      'asset-status': () => assetPreview.status,
      'asset-width': () => assetPreview.width,
      'asset-height': () => assetPreview.height,
      'asset-duration': () => assetPreview.duration,
      'asset-time': () => assetPreview.position,
      'asset-playing?': () => assetPreview.playing,
      'play-asset': actions(() => assetPreview.play()),
      'pause-asset': actions(() => assetPreview.pause()),
      'stop-asset': actions(() => assetPreview.stop()),
      'seek-asset': actions((seconds) => assetPreview.seek(seconds)),
      'close-asset-preview': actions(() => {
        assetPreview.close();
        state.window = '';
      }),
      'asset-image': (origin, size) => draw.surface(origin, size, 6),
      'asset-waveform': (origin, size) => {
        for (const [i, peak] of (assetPreview.peaks ?? []).entries()) {
          const x = origin[0] + (i / 512) * size[0];
          draw.line(
            [x, origin[1] + (0.5 - peak[1] * 0.46) * size[1]],
            [x, origin[1] + (0.5 - peak[0] * 0.46) * size[1]],
            1,
          );
        }
      },
      'image-preview': (origin, size) => {
        draw.surface(origin, size, 5);
        const program = outputGenerator(result.generators ?? generatorPrograms, target, 'image');
        if (program?.unified) draw.composite(program.runtime.drawFrame(), origin, size);
      },
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
        const hit =
          inBox(pointer.x, pointer.y, origin, size) &&
          inBox(pointer.x, pointer.y, draw.state.clip.slice(0, 2), draw.state.clip.slice(2));
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
        const clip = [...draw.state.clip];
        if (
          origin[0] + size[0] <= clip[0] ||
          origin[1] + size[1] <= clip[1] ||
          origin[0] >= clip[0] + clip[2] ||
          origin[1] >= clip[1] + clip[3]
        )
          return;
        items.push({ id, label, origin, size, key, low, high, clip });
      },
      'scroll-region': (id, origin, size, scrollKey, scrollLimit) => {
        const offset = Math.max(0, Math.min(scrollLimit, state[scrollKey] ?? 0));
        state[scrollKey] = offset;
        items.push({ id, label: 'Scrollable inspector', origin, size, scrollKey, scrollLimit });
        return offset;
      },
      surface: (origin, size) => {
        draw.surface(origin, size);
        const application = result.gameRuntime ?? gameRuntime;
        const scene = 'scene' in result ? result.scene : activeScene;
        if (application) draw.composite(application.drawFrame(...canvasSize(target)), origin, size);
        if (scene) draw.composite(scene.runtime.drawFrame(...canvasSize(target)), origin, size);
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
                : tab.startsWith('__')
                  ? sources[tab]
                  : visibleSources()[tab];
        if (typeof text !== 'string') throw new Error(`Unknown source buffer ${tab}`);
        if (live()) {
          buffer = code.layout(
            origin,
            size,
            tab,
            text,
            tab === '__textResource' || !(tab in visibleSources()),
            performance.now(),
            { lineHeight: target['ui-code-line-height'], gutter: target['ui-code-gutter'] },
          );
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
      'buffer-hooks': () => buffer.hooks,
      'inspect-inline-hook': actions((name) => {
        state['hook-path'] = sourcePath(code.tab);
        inspectHook(state['hook-path'], name).catch((error) => report(error.message, true));
      }),
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
      'evaluate-project': actions(() => runProject()),
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
        const editorKeys = ['main', ...editorSourcePaths];
        const backups = editorKeys.filter(
          (key) =>
            key in sources &&
            sources[key] !== (key === editorKeys[0] ? defaults.main : defaults[key]),
        );
        if (
          Object.keys(sources).filter((key) => !key.startsWith('__')).length + backups.length >
          256
        )
          throw new Error('Make room for editor backups before upgrading');
        for (const key of backups) {
          const stem = key.replace(/\.lisp$/, '');
          let index = 1;
          while (
            `${stem}-backup-${index}.lisp` in sources ||
            `${stem}-backup-${index}.lisp` in resources
          )
            index++;
          const backup = `${stem}-backup-${index}.lisp`;
          sources[backup] = sources[key];
          let owned;
          try {
            owned = JSON.parse(state['editor-file-paths'] ?? '[]');
          } catch {
            owned = [];
          }
          state['editor-file-paths'] = JSON.stringify([
            ...new Set([...(Array.isArray(owned) ? owned : []), sourcePath(backup)]),
          ]);
        }
        for (const key of editorKeys)
          sources[key] = key === editorKeys[0] ? defaults.main : defaults[key];
        if (await evaluate({ exitRecovery: true }))
          report('Latest editor installed. Previous custom sources are kept in backup files.');
      }),
      'export-html': actions(async () => {
        if (!(await evaluate())) throw new Error('Fix the project errors before exporting');
        const html = await exportHTML(
          applicationFiles(committedSources, state['editor-file-paths']).game,
          resources,
          undefined,
          { 'canvas-width': canvasSize(state)[0], 'canvas-height': canvasSize(state)[1] },
        );
        download(html, 'text/html', 'game.html');
      }),
      'export-project': actions(() =>
        download(
          JSON.stringify(
            projectSnapshot(sources, state, resources, recovery, applicationState),
            null,
            2,
          ),
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
          const size = canvasSize(state), list = new DrawList(...size);
          list.surface([0, 0], size);
          list.composite(gameRuntime.drawFrame(...size), [0, 0], size);
          if (activeScene) list.composite(activeScene.runtime.drawFrame(...size), [0, 0], size);
          download(await gpu.snapshot(false, list, activeScene ? sceneTime : time, applicationState, state), 'image/png', 'aioli.png');
        } catch (e) {
          report(e.message, true);
        }
      }),
    },
  });
  result.pendingActions = [];
  result.drawFrame = (width = 320, height = 240, name = 'render', args = []) => {
    const outer = draw;
    draw = new DrawList(width, height);
    try { result.call(name, ...args); return draw; } finally { draw = outer; }
  };
  result.drawEditor = () => {
    draw = new DrawList(innerWidth, innerHeight);
    items = [];
    try {
      result.call(result.global.render?.hook?.kind === 'draw' ? 'render' : typeof result.global.draw === 'function' ? 'draw' : 'editor');
      return { draw, regions: items };
    } finally {
      draw = null;
    }
  };
  result.collectSound = (name = 'sound', ...args) => {
    patch = [];
    if (name !== 'sound' && result.global[name]?.hook?.kind !== 'sound')
      throw new Error(`Missing sound hook ${name}`);
    if (typeof result.global[name] === 'function') result.call(name, ...args);
    return patch;
  };
  result.collectGeneratedSound = () => {
    patch = [];
    if (typeof result.global['generate-sound'] === 'function') result.call('generate-sound');
    return patch;
  };
  return result;
}
/** Whole-project execution shared by Ctrl+Enter and the main.lisp run button. */
function runProject() {
  clearTimeout(timer);
  return evaluate();
}

/** Stage all sources and a GPU pipeline, then commit only the newest valid edit. */
async function evaluate({
  reset = false,
  restart = false,
  imported = null,
  exitRecovery = false,
  scene = undefined,
  generator = undefined,
} = {}) {
  const id = ++revision;
  pending = true;
  message = 'Evaluating…';
  try {
    const candidateSources = { ...(imported?.sources ?? sources) },
      baseline = { ...state },
      gameBaseline = { ...applicationState };
    // File operations and gameplay edits are not repairs to the editor. Keep
    // the recovery shell until its sources are explicitly changed and accepted.
    const editorChanged = [...new Set(['main', 'main', 'ui', ...editorSourcePaths])].some(
      (key) => candidateSources[key] !== committedSources[key],
    );
    const nextRecovery = !exitRecovery && (imported?.recovery ?? (recovery && !editorChanged));
    const target = Object.assign(Object.create(null), imported?.state ?? (reset ? {} : state));
    const candidate = makeRuntime(target, candidateSources, imported?.resources ?? resources);
    const appPath = rolePath(candidateSources, 'app', true);
    if (!(target.tab in candidateSources)) target.tab = 'game';
    if (
      !target['selected-file'] ||
      (!(sourceKey(target['selected-file']) in candidateSources) &&
        !(target['selected-file'] in (imported?.resources ?? resources)))
    )
      target['selected-file'] = 'game.lisp';
    const stores = applicationFiles(candidateSources, target['editor-file-paths']);
    const gameTarget = Object.assign(
      Object.create(null),
      imported?.applicationState ?? (reset || restart ? {} : applicationState),
    );
    candidate.applicationState = gameTarget;
    const lifecycle = !runtime || imported || reset ? 'init' : 'reload';
    launchApplication({
      files: stores.editor,
      entry: appPath,
      state: target,
      lifecycle,
      makeRuntime: () => candidate,
    });
    const logicalSize = canvasSize(target);
    const makeGameRuntime = (targetState = gameTarget) => {
      let staged;
      const services = engineServices({
        size: () => logicalSize,
        key: (key) => code.focus === 'world' && keys.has(key),
        pointer: () => {
          const viewport = regions.find((region) => region.id === 'world');
          return {
            x: viewport
              ? ((pointer.x - viewport.origin[0]) * logicalSize[0]) / viewport.size[0]
              : 0,
            y: viewport
              ? ((pointer.y - viewport.origin[1]) * logicalSize[1]) / viewport.size[1]
              : 0,
            down: code.focus === 'world' && pointer.down,
            pressed: code.focus === 'world' && pointer.pressed,
          };
        },
        startScene: (path = '') => {
          path = path ? resolvePath(path) : '';
          if (staged === gameRuntime || staged === activeScene?.runtime)
            defer(() => evaluate({ scene: path }));
          else if (staged) staged.initialScene = path;
        },
        playSound: (name = 'sound', ...args) => {
          const play = () => {
            try {
              if (name === 'sound') return playPatch().catch((e) => report(e.message, true));
              return playSamples(synthesize(staged.collectSound(name, ...args))).catch((e) =>
                report(e.message, true),
              );
            } catch (e) {
              report(e.message, true);
            }
          };
          if (staged === gameRuntime || staged === activeScene?.runtime) play();
          else if (staged?.captureActions) staged.pendingActions.push(play);
        },
        resource: (path) => (imported?.resources ?? resources)[resolvePath(path)]?.data ?? '',
      });
      staged = services.create(targetState);
      staged.pendingActions = [];
      return staged;
    };
    const gameCandidate = makeGameRuntime();
    candidate.gameRuntime = gameCandidate;
    launchApplication({
      files: stores.game,
      entry: 'game.lisp',
      state: gameTarget,
      lifecycle: scene === undefined ? (restart ? 'init' : lifecycle) : '',
      makeRuntime: () => gameCandidate,
    });
    const scenePath = selectScene({
      explicit: scene,
      requested: gameCandidate.initialScene,
      previousRequest:
        reset || restart
          ? undefined
          : imported
            ? gameTarget['entry-scene-request']
            : (gameRuntime?.initialScene ?? gameTarget['entry-scene-request']),
      active: gameTarget['active-scene'],
      activating: !runtime || !!imported || reset || restart,
    });
    gameTarget['entry-scene-request'] = gameCandidate.initialScene ?? '';
    const sceneChanged = scenePath !== (activeScene?.path ?? '') || reset || restart || !!imported;
    // Run exit against staged state too: a failed shader must not leave the old
    // scene or leak its cleanup effects. Exit precedes the incoming init/enter.
    const exitTarget = reset || restart || imported ? { ...applicationState } : gameTarget;
    const outgoingRoot =
      exitTarget === gameTarget || !activeScene
        ? gameCandidate
        : launchApplication({
            files: applicationFiles(committedSources, state['editor-file-paths']).game,
            entry: 'game.lisp',
            state: exitTarget,
            lifecycle: '',
            makeRuntime: () => makeGameRuntime(exitTarget),
          });
    const outgoing =
      sceneChanged && activeScene && typeof activeScene.runtime.global.exit === 'function'
        ? stageScene(
            applicationFiles(committedSources, state['editor-file-paths']).game,
            activeScene.path,
            outgoingRoot,
            () => makeGameRuntime(exitTarget),
          )
        : null;
    callLifecycle(outgoing?.runtime, 'exit');
    const nextScene = scenePath
      ? stageScene(stores.game, scenePath, gameCandidate, makeGameRuntime)
      : null;
    gameTarget['active-scene'] = scenePath;
    candidate.scene = nextScene;
    const declared = new Map();
    candidate.sceneStateKeys = (nextScene?.runtime ?? gameCandidate).stateKeys;
    for (const module of resolveModules(stores.game, [scenePath || 'game.lisp'])) {
      referencedStateKeys(module.forms, candidate.sceneStateKeys);
      for (const field of inspectorFields(module.path, module.forms))
        declared.set(field.key, field);
    }
    candidate.sceneFields = [...declared.values()];
    if (sceneChanged) {
      target['scene-inspector-offset'] = 0;
      target['scene-edit-key'] = '';
    }
    if (nextScene) {
      callLifecycle(nextScene.runtime, sceneChanged || !activeScene ? 'init' : 'reload');
      if (sceneChanged || !activeScene) callLifecycle(nextScene.runtime, 'enter');
      callHook(nextScene.runtime, 'update', 0);
    }
    if (generator !== undefined) target['active-generator'] = generator;
    const nextGenerators = stageGenerators(candidateSources, candidate, () =>
      makeRuntime(target, candidateSources, imported?.resources ?? resources),
    );
    candidate.generators = nextGenerators;
    const selected = selectedGenerator(nextGenerators, target);
    target['active-generator'] = selected?.path ?? '';
    if (selected) target[`${selected.output}-generator-path`] = selected.path;
    for (const program of nextGenerators)
      for (const field of program.fields) {
        try {
          target[field.key] = fieldValue(field, target[field.key]);
        } catch {
          target[field.key] = field.value;
        }
      }
    const imageGenerator = outputGenerator(nextGenerators, target, 'image');
    const audioGenerator = outputGenerator(nextGenerators, target, 'audio');
    const stagedDraw = candidate.drawEditor().draw;
    if (gpu) await gpu.preparePixels(stagedDraw);
    gameCandidate.collectSound();
    const shader = compileShader(nextScene?.render ?? gameCandidate.render(), gameTarget),
      imageShader = compileShader(
        imageGenerator?.render ?? parse('(defpixel image [p time] (background "#000000"))'),
        target,
      ),
      pipeline = gpu ? await gpu.prepare(shader) : null,
      imagePipeline = gpu ? await gpu.prepare(imageShader) : null;
    const generatedPatch = audioGenerator?.runtime.collectGeneratedSound() ?? [];
    const nextGeneratedSound = generatedPatch.length
      ? synthesize(generatedPatch)
      : new Float32Array(4410);
    if (id !== revision) return;
    // Preserve state updates that happened while the GPU was compiling.
    if (!reset && !imported)
      for (const [key, value] of Object.entries(state))
        if (value !== baseline[key] && target[key] === baseline[key]) target[key] = value;
    if (!reset && !restart && !imported)
      for (const [key, value] of Object.entries(applicationState))
        if (value !== gameBaseline[key] && gameTarget[key] === gameBaseline[key])
          gameTarget[key] = value;
    // Nothing above this point replaces the running program. Draft text remains
    // editable even if validation fails; persistence only uses committedSources.
    if (gpu) gpu.resizeScene(...logicalSize);
    state = target;
    runtime = candidate;
    gameRuntime = gameCandidate;
    sceneFields = candidate.sceneFields;
    sceneStateKeys = candidate.sceneStateKeys;
    applicationState = gameTarget;
    activeScene = nextScene;
    if (sceneChanged) sceneTime = 0;
    compiled = shader;
    for (const key of Object.keys(sources)) if (!key.startsWith('__')) delete sources[key];
    Object.assign(sources, candidateSources);
    if (imported) {
      resources = imported.resources ?? Object.create(null);
      hookPreview = null;
    }
    committedSources = { ...candidateSources };
    if (pipeline) gpu.commit(pipeline, shader);
    if (imagePipeline) gpu.commitImage(imagePipeline, imageShader);
    generatedSound = nextGeneratedSound;
    generatorPrograms = nextGenerators;
    const acceptedEditorState = { ...state };
    rescueRuntime = makeRuntime(state);
    for (const module of resolveModules(defaults, ['main']))
      rescueRuntime.load(cpuForms(module.forms));
    Object.assign(state, acceptedEditorState);
    document.documentElement.style.setProperty('--ui-bg', state['ui-bg'] ?? '#1e1f1c');
    document.documentElement.style.setProperty('--ui-text', state['ui-text'] ?? '#f8f8f2');
    gameFailed = false;
    editorFailed = false;
    recovery = nextRecovery;
    refreshAudio(true);
    for (const program of [candidate, gameCandidate, outgoing?.runtime, nextScene?.runtime])
      for (const action of program?.pendingActions ?? []) defer(action);
    if (save()) report(gpuFailure || 'Saved', Boolean(gpuFailure));
    return true;
  } catch (e) {
    if (id === revision) report(e.message, true);
    return false;
  }
}
async function evaluateGeneratorSelection(path) {
  return evaluate({ generator: path });
}
function refreshAudio(force = false) {
  if (!runtime) return;
  const generatedPatch =
    outputGenerator(generatorPrograms, state, 'audio')?.runtime.collectGeneratedSound() ?? [];
  const generatedSignature = JSON.stringify(generatedPatch);
  if (force || generatedSignature !== refreshAudio.generatedSignature) {
    generatedSound = generatedPatch.length ? synthesize(generatedPatch) : new Float32Array(4410);
    refreshAudio.generatedSignature = generatedSignature;
  }
  const patch = (
      typeof activeScene?.runtime.global.sound === 'function' ? activeScene.runtime : gameRuntime
    ).collectSound(),
    signature = JSON.stringify(patch);
  if (!force && signature === audioSignature) return;
  voices = patch;
  samples = voices.length ? synthesize(voices) : new Float32Array(4410);
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
  path = resolvePath(path);
  if (!isCommandFile(path)) throw new Error('Commands must end in .command.lisp');
  const modules = resolveModules(sources, [path]);
  for (const module of modules) runtime.load(cpuForms(module.forms));
  dirty = true;
  report(`Executed ${path}`);
}
function runInstruction(text) {
  if (!text.trim()) throw new Error('Type a Lisp program or choose a command');
  const modules = resolveModules({ ...sources, 'instruction.command.lisp': text }, [
    'instruction.command.lisp',
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
  assertFileDestination(path);
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
  gpu.draw(lastDraw, activeScene ? sceneTime : time, applicationState, state);
  const program = outputGenerator(generatorPrograms, state, 'image');
  let list;
  if (program?.unified) {
    list = new DrawList(320, 240);
    list.surface([0, 0], [320, 240], 5);
    list.composite(program.runtime.drawFrame(), [0, 0], [320, 240]);
  }
  await storeGenerated(path, await gpu.snapshot(true, list, 0, applicationState, state), shouldDownload);
}
async function exportGeneratedText(shouldDownload) {
  const program = selectedGenerator(generatorPrograms, state);
  const output = textOutput(program);
  if (output.error) throw new Error(output.error);
  await storeGenerated(
    program.filename,
    new Blob([output.text], { type: textMime(program.filename) }),
    shouldDownload,
  );
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
  const current = regions.filter((r) => !r.scrollKey && !['source', 'world'].includes(r.id)),
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
      control.step = r.step ?? (r.high - r.low <= 2 ? 0.01 : 1);
      control.value = state[r.key];
      control.dataset.key = r.key;
      control.setAttribute('aria-label', r.label);
      control.oninput = () => {
        state[r.key] = Number(control.value);
        if (r.key.startsWith('__scene-')) {
          const key = r.key.slice(8);
          const field = liveFields(sceneFields, applicationState, sceneStateKeys).find(
            (field) => field.key === key,
          );
          if (field) applicationState[key] = fieldValue(field, Number(control.value));
        }
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
function treeOffset(
  target,
  rows = resourceRows(),
  capacity = Math.min(
    64,
    Math.max(1, Math.floor((innerHeight - 136) / (state['ui-file-row-height'] ?? 26))),
  ),
) {
  const total = projectTree(
    rows,
    target['open-folders'],
    savedFolders(target['project-folders']),
  ).length;
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
function saveFilePath() {
  if (['image-asset', 'audio-asset'].includes(state.window)) return state['preview-path'];
  if (state.window === 'generator') return state['active-generator'];
  if (state.tab in sources && !state.tab.startsWith('__')) return sourcePath(state.tab);
  return state['selected-file'] in resources ? state['selected-file'] : '';
}
function downloadFile(path) {
  path = resolvePath(path);
  if (sourceKey(path) in sources)
    download(sources[sourceKey(path)], 'text/plain', path.split('/').at(-1));
  else if (resources[path]) {
    const a = document.createElement('a');
    a.href = resources[path].data;
    a.download = path.split('/').at(-1);
    a.click();
  } else throw new Error('Missing file');
}
function assertFileDestination(path) {
  if (folderPaths(sources, resources, savedFolders(state['project-folders'])).has(path))
    throw new Error('A folder already uses that path');
  if (filePaths(sources, resources).some((file) => path.startsWith(file + '/')))
    throw new Error('A file already uses a parent path');
}
async function moveProjectFile(oldPath, newPath) {
  if (oldPath === newPath) return;
  assertFileDestination(newPath);
  const plan = planFileMove(sources, resources, oldPath, newPath);
  const before = {
    sources: { ...sources },
    resources,
    state: { ...state },
    applicationState: { ...applicationState },
  };
  const replace = (target, values) => {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, values);
  };
  replace(sources, plan.sources);
  resources = plan.resources;
  if (plan.oldKey in before.sources) renameTab(state, sources, plan.oldKey, plan.newKey);
  for (const record of [state, applicationState])
    for (const [key, value] of Object.entries(record)) {
      if (value === oldPath) record[key] = newPath;
      else if (typeof value === 'string' && value.startsWith('['))
        record[key] = value.replaceAll(JSON.stringify(oldPath), JSON.stringify(newPath));
    }
  state['selected-file'] = newPath;
  const folder = newPath.split('/').slice(0, -1).join('/');
  if (folder && !JSON.parse(state['open-folders']).includes(folder))
    state['open-folders'] = toggleFolder(state['open-folders'], folder);
  if (await evaluate()) {
    code.renameBuffer(plan.oldKey, plan.newKey);
    report(`Moved ${oldPath} to ${newPath}`);
  } else {
    replace(sources, before.sources);
    resources = before.resources;
    replace(state, before.state);
    replace(applicationState, before.applicationState);
  }
}
function createProjectFolder(path) {
  const folders = savedFolders(state['project-folders']);
  path = validateFolderPath(sources, resources, folders, path);
  const persisted = new Set(folders);
  const ancestors = path.split('/');
  for (let i = 1; i <= ancestors.length; i++) persisted.add(ancestors.slice(0, i).join('/'));
  if (persisted.size > 256) throw new Error('Maximum 256 explicit folders');
  state['project-folders'] = JSON.stringify([...persisted]);
  const expanded = new Set(savedFolders(state['open-folders']));
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
  state['open-folders'] = JSON.stringify([...expanded]);
  state.window = '';
  state['file-offset'] = 0;
  dirty = true;
  report(`Created folder ${path}`);
}
const replaceStore = (target, values) => {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, values);
};
async function moveProjectFolder(oldPath, newPath) {
  if (oldPath === newPath) {
    state.window = '';
    return;
  }
  const plan = planFolderMove(
    sources,
    resources,
    savedFolders(state['project-folders']),
    oldPath,
    newPath,
  );
  const before = {
    sources: { ...sources },
    resources,
    state: { ...state },
    applicationState: { ...applicationState },
  };
  replaceStore(sources, plan.sources);
  resources = plan.resources;
  for (const [from, to] of plan.moves)
    if (sourceKey(from) in before.sources)
      renameTab(state, sources, sourceKey(from), sourceKey(to));
  const pathFields = [
    'selected-file',
    'preview-path',
    'active-generator',
    'image-generator-path',
    'audio-generator-path',
    'text-generator-path',
    'context-path',
    'hook-path',
  ];
  for (const key of pathFields)
    if (typeof state[key] === 'string') state[key] = plan.remap(state[key]);
  for (const key of ['open-folders', 'editor-file-paths'])
    if (state[key]) state[key] = JSON.stringify(savedFolders(state[key]).map(plan.remap));
  for (const [key, value] of Object.entries(applicationState))
    if (typeof value === 'string') applicationState[key] = plan.remap(value);
  state['project-folders'] = JSON.stringify(plan.folders);
  const expanded = new Set(savedFolders(state['open-folders']));
  const parts = newPath.split('/');
  for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
  state['open-folders'] = JSON.stringify([...expanded]);
  state.window = '';
  state['file-context'] = false;
  state['file-offset'] = 0;
  if (await evaluate()) {
    for (const [from, to] of plan.moves)
      if (sourceKey(from) in before.sources) code.renameBuffer(sourceKey(from), sourceKey(to));
    report(`Moved folder ${oldPath} to ${newPath}`);
  } else {
    replaceStore(sources, before.sources);
    resources = before.resources;
    replaceStore(state, before.state);
    replaceStore(applicationState, before.applicationState);
  }
}
async function deleteProjectFolder(path) {
  path = resolvePath(path);
  if (!folderPaths(sources, resources, savedFolders(state['project-folders'])).has(path))
    throw new Error('Missing folder');
  const before = {
    sources: { ...sources },
    resources,
    state: { ...state },
    applicationState: { ...applicationState },
  };
  const removed = filePaths(sources, resources).filter((file) => insideFolder(file, path));
  resources = { ...resources };
  for (const file of removed) {
    const key = sourceKey(file);
    if (key in sources) {
      closeTab(state, sources, key);
      delete sources[key];
    }
    delete resources[file];
  }
  for (const key of ['project-folders', 'open-folders'])
    state[key] = JSON.stringify(
      savedFolders(state[key]).filter((folder) => !insideFolder(folder, path)),
    );
  state['file-context'] = false;
  state.window = '';
  if (await evaluate()) {
    for (const file of removed) code.forgetBuffer(sourceKey(file));
    report(`Deleted folder ${path} / ${removed.length} files`);
  } else {
    replaceStore(sources, before.sources);
    resources = before.resources;
    replaceStore(state, before.state);
    replaceStore(applicationState, before.applicationState);
    state['file-context'] = false;
    report(`Folder still in use: ${message}`, true);
  }
}
let fileDrag = null;
function updateFileDrag() {
  if (!fileDrag?.active) return;
  const row = fileRegionAt(pointer.x, pointer.y);
  const header = regions.find((r) => r.id === 'collapse-files');
  fileDrag.folder =
    row?.resourceKind === 'folder'
      ? row.resourcePath
      : row?.resourcePath
        ? row.resourcePath.split('/').slice(0, -1).join('/')
        : row?.id === 'files-tree' ||
            (header && inBox(pointer.x, pointer.y, header.origin, header.size))
          ? ''
          : null;
  canvas.style.cursor = fileDrag.folder === null ? 'no-drop' : 'grabbing';
  const tree = regions.find((r) => r.id === 'files-tree');
  if (
    tree &&
    inBox(pointer.x, pointer.y, tree.origin, tree.size) &&
    performance.now() - (fileDrag.scrollTime ?? 0) > 120
  ) {
    const direction =
      pointer.y < tree.origin[1] + 20 ? -1 : pointer.y > tree.origin[1] + tree.size[1] - 20 ? 1 : 0;
    if (direction) {
      state['file-offset'] = Math.max(0, state['file-offset'] + direction);
      fileDrag.scrollTime = performance.now();
    }
  }
}
function fileRegionAt(x, y) {
  // Ignore the existing context backdrop so right-click can change its target.
  // Child action buttons inherit their containing resource row's context.
  return regions.findLast(
    (row) => (row.resourcePath || row.id === 'files-tree') && inBox(x, y, row.origin, row.size),
  );
}
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openFileContext(fileRegionAt(e.clientX, e.clientY), e.clientX, e.clientY);
});
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (e.button === 2) {
    openFileContext(fileRegionAt(pointer.x, pointer.y), pointer.x, pointer.y);
    return;
  }
  if (e.button !== 0) return;
  pointer.down = true;
  pointer.pressed = true;
  pointer.target = topRegion(pointer.x, pointer.y);
  canvas.setPointerCapture(e.pointerId);
  if (
    !pending &&
    !state.window &&
    !state.menu &&
    !state['file-context'] &&
    pointer.target?.resourcePath
  ) {
    fileDrag = {
      path: pointer.target.resourcePath,
      kind: pointer.target.resourceKind,
      x: pointer.x,
      y: pointer.y,
      active: false,
      folder: null,
    };
    pointer.pressed = false;
  }
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
  if (pointer.down && fileDrag && Math.hypot(pointer.x - fileDrag.x, pointer.y - fileDrag.y) > 6) {
    fileDrag.active = true;
    updateFileDrag();
  }
  if (pointer.down && code.drag) code.pointer(pointer.x, pointer.y, true);
});
const release = () => {
  pointer.down = false;
  pointer.capture = null;
  pointer.target = null;
  code.drag = false;
  fileDrag = null;
  canvas.style.cursor = '';
};
canvas.addEventListener('pointerup', () => {
  if (fileDrag) {
    const drag = fileDrag;
    if (drag.active) {
      updateFileDrag();
      if (drag.folder !== null)
        defer(() =>
          (drag.kind === 'folder' ? moveProjectFolder : moveProjectFile)(
            drag.path,
            (drag.folder ? drag.folder + '/' : '') + drag.path.split('/').at(-1),
          ),
        );
    } else activations.add((drag.kind === 'folder' ? 'folder-' : 'file-') + drag.path);
  }
  release();
});
canvas.addEventListener('pointercancel', release);
canvas.addEventListener(
  'wheel',
  (e) => {
    const scroll = regions.findLast(
      (r) => r.scrollKey && inBox(e.clientX, e.clientY, r.origin, r.size),
    );
    if (
      scroll &&
      !state.menu &&
      !state['file-context'] &&
      (state.window === '' ||
        (state.window === 'generator' &&
          ['generator-inspector-scroll', 'generator-text-scroll'].includes(scroll.id)))
    ) {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? scroll.size[1] : 1);
      if (
        scroll.id === 'generator-text-scroll' &&
        (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))
      ) {
        e.preventDefault();
        state['text-preview-x'] = Math.max(
          0,
          (state['text-preview-x'] ?? 0) + (e.deltaX || e.deltaY),
        );
        return;
      }
      state[scroll.scrollKey] = Math.max(
        0,
        Math.min(scroll.scrollLimit, state[scroll.scrollKey] + delta),
      );
      dirty = true;
      return;
    }
    const imageArea = topRegion(e.clientX, e.clientY);
    if (imageArea?.id === 'asset-image-area') {
      e.preventDefault();
      const fit = Math.min(
        1,
        imageArea.size[0] / assetPreview.width,
        imageArea.size[1] / assetPreview.height,
      );
      const old = state['preview-zoom'];
      const next = Math.max(0.1, Math.min(32 / fit, old * Math.pow(1.15, -Math.sign(e.deltaY))));
      const cx = imageArea.origin[0] + imageArea.size[0] / 2,
        cy = imageArea.origin[1] + imageArea.size[1] / 2;
      state['preview-pan-x'] =
        e.clientX - cx - ((e.clientX - cx - state['preview-pan-x']) * next) / old;
      state['preview-pan-y'] =
        e.clientY - cy - ((e.clientY - cy - state['preview-pan-y']) * next) / old;
      state['preview-zoom'] = next;
      dirty = true;
      return;
    }
    const tree = regions.find((region) => region.id === 'files-tree');
    if (
      state.window === '' &&
      !state.menu &&
      !state['file-context'] &&
      tree &&
      inBox(e.clientX, e.clientY, tree.origin, tree.size)
    ) {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const max = Math.max(0, runtime.call('project-tree-width') - tree.size[0] + 12);
        const delta =
          (e.deltaX || e.deltaY) * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? tree.size[0] : 1);
        state['file-scroll-x'] = Math.max(0, Math.min(max, (state['file-scroll-x'] ?? 0) + delta));
        dirty = true;
        return;
      }
      const rows = Math.min(
        64,
        Math.max(1, Math.floor(tree.size[1] / (state['ui-file-row-height'] ?? 26))),
      );
      const count = projectTree(
        resourceRows(),
        state['open-folders'],
        savedFolders(state['project-folders']),
      ).length;
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
  state.tab = 'main';
  state['show-code'] = true;
  state['show-tools'] = false;
  state['file-path-editing'] = false;
  state.menu = false;
  state.window = '';
  dirty = true;
  report('Recovery shell. Adopt the latest editor or edit its sources and run.');
}
let previewReturnFocus = 'code';
function togglePreviewFocus() {
  if (!state['preview-focused']) previewReturnFocus = code.focus;
  state['preview-focused'] = !state['preview-focused'];
  code.focus = state['preview-focused'] ? 'world' : previewReturnFocus;
  state.menu = false;
  keys.clear();
  canvas.focus();
  dirty = true;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fileDrag) {
    e.preventDefault();
    release();
    return;
  }

  if (e.key === 'F4' || (e.key === 'Escape' && state['preview-focused'] && !state.menu)) {
    e.preventDefault();
    togglePreviewFocus();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && ['s', 'o'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    state.menu = false;
    if (e.key.toLowerCase() === 'o') $('file-input').click();
    else
      download(
        JSON.stringify(
          projectSnapshot(sources, state, resources, recovery, applicationState),
          null,
          2,
        ),
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
    else runProject();
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
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (key.length === 1 || key.startsWith('Arrow'))) {
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
$('open-file-input').onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const path = resolvePath(file.name),
      key = sourceKey(path);
    assertFileDestination(path);
    if (file.size > 6000000) throw new Error('File exceeds 6MB');
    if (key in sources || path in resources) throw new Error(`File already exists: ${path}`);
    if (path.endsWith('.lisp') || isScenePath(path)) {
      if (Object.keys(sources).filter((k) => !k.startsWith('__')).length >= 256)
        throw new Error('Maximum 256 source files');
      const text = normalizeSource(await file.text());
      if (text.length > 100000) throw new Error('Source exceeds 100KB');
      sources[key] = text;
      openTab(state, sources, key);
      state['show-code'] = true;
      state['code-collapsed'] = false;
    } else {
      if (Object.keys(resources).length >= 256) throw new Error('Maximum 256 assets');
      resources[path] = {
        mime: file.type || 'application/octet-stream',
        data: await asDataURL(file),
      };
    }
    state['selected-file'] = path;
    state.window = '';
    if ((await evaluate()) && /^(image|audio)\//.test(file.type)) await previewAsset(path);
  } catch (error) {
    report(error.message, true);
  } finally {
    event.target.value = '';
  }
};
$('resource-input').onchange = async (event) => {
  try {
    for (const file of event.target.files) {
      const path = resolvePath(`assets/${file.name}`);
      if (sourceKey(path) in sources || path in resources)
        throw new Error(`File already exists: ${path}`);
      if (file.size > 6000000) throw new Error('Resource exceeds 6MB');
      if (path.endsWith('.lisp') || isScenePath(path)) {
        if (Object.keys(sources).filter((key) => !key.startsWith('__')).length >= 256)
          throw new Error('Maximum 256 source files');
        const text = await file.text();
        if (text.length > 100000) throw new Error('Source exceeds 100KB');
        sources[path] = normalizeSource(text);
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

$('generator-color').addEventListener('input', (event) => {
  if (sceneColorKey) {
    const field = liveFields(sceneFields, applicationState, sceneStateKeys).find(
      (field) => field.key === sceneColorKey,
    );
    if (field) applicationState[field.key] = fieldValue(field, event.target.value);
  } else {
    const field = selectedGenerator(generatorPrograms, state)?.fields.find(
      (field) => field.key === state['inspector-edit-key'],
    );
    if (field) state[field.key] = fieldValue(field, event.target.value);
  }
  dirty = true;
});
$('generator-color').addEventListener('change', () => {
  state['scene-edit-key'] = '';
  sceneColorKey = null;
  state['inspector-edit-key'] = '';
});

function frame(now) {
  // Gameplay may pause/fail independently. Keep the editor available for repairs.
  const dt = Math.min((now - lastFrame) / 1000, 0.04);
  lastFrame = now;
  if (runtime) {
    try {
      if (!state.paused && !gameFailed) {
        time += dt;
        callHook(gameRuntime, 'update', dt);
        callHook(activeScene?.runtime, 'update', dt);
        sceneTime += dt;
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
      if (['hook-draw', 'hook-sound', 'hooks'].includes(state.window) && !hookPreview)
        state.window = '';
      if (state.window === 'hook-sound' && hookPreview?.resource) {
        assetPreview.open(state['preview-path'], hookPreview.resource, 'audio');
      } else if (state.window === 'image-asset' || state.window === 'audio-asset') {
        const resource = resources[state['preview-path']];
        assetPreview.open(
          state['preview-path'],
          resource,
          state.window === 'image-asset' ? 'image' : 'audio',
        );
      } else if (assetPreview.path) assetPreview.close();
      callHook(ui, 'update', dt);
      updateFileDrag();
      const result = ui.drawEditor();
      lastDraw = result.draw;
      regions = result.regions;
      accessibility();
    } catch (e) {
      editorFailed = true;
      report(`Editor: ${e.message}. Press F2 for recovery.`, true);
    }
    try {
      if (gpu && lastDraw)
        gpu.draw(lastDraw, activeScene ? sceneTime : time, applicationState, state);
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
  if (!pointer.down) pointer.capture = null;
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
  for (const key of Object.keys(sources)) if (!key.startsWith('__')) delete sources[key];
  Object.assign(sources, failedSources);
  recovery = true;
  state.tab = 'main';
  report(`Opened recovery shell: ${failure}`, true);
}
requestAnimationFrame(frame);
// Read-only snapshots for integration checks, not a second editor control API.
window.aioli = {
  get state() {
    return { ...applicationState, ...state };
  },
  get editorState() {
    return { ...state };
  },
  get applicationState() {
    return { ...applicationState };
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
  get hookPreview() {
    return (
      hookPreview && {
        name: hookPreview.name,
        kind: hookPreview.kind,
        args: hookPreview.args,
        state: structuredClone(hookPreview.state),
        commands: hookPreview.draw?.commands,
        samples: hookPreview.pcm?.length,
      }
    );
  },
  get preview() {
    return {
      path: assetPreview.path,
      kind: assetPreview.kind,
      ready: assetPreview.ready,
      width: assetPreview.width,
      height: assetPreview.height,
      duration: assetPreview.duration,
      position: assetPreview.position,
      playing: assetPreview.playing,
      status: assetPreview.status,
    };
  },
  get resources() {
    return structuredClone(resources);
  },
  get recovery() {
    return recovery;
  },
};

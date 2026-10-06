import { createRuntime } from './lisp.js';
import { resolveModules } from './module-loader.js';
import { stageScene, callHook, callLifecycle, selectScene } from './scenes.js';

/** Launch an application from an explicit entry and a private module/state store.
 * Filenames carry no runtime semantics. Services are supplied by its host. */
export function launchApplication({
  files,
  entry = 'main.lisp',
  state = {},
  services = {},
  lifecycle = 'init',
  makeRuntime,
}) {
  const runtime = makeRuntime ? makeRuntime(state) : createRuntime(state, services);
  runtime.pendingActions = [];
  runtime.files = files;
  runtime.entry = entry;
  const modules = resolveModules(files, [entry]);
  runtime.modules = modules;
  for (const module of modules) {
    try {
      runtime.load(module.forms, module.path);
    } catch (error) {
      throw new Error(`${module.path}: ${error.message}`);
    }
  }
  callLifecycle(runtime, lifecycle);
  callHook(runtime, 'update', 0);
  return runtime;
}

export { callHook, callLifecycle, selectScene };

/** One transactional scene/lifecycle path for embedded and standalone apps. */
export function stageApplication({
  files,
  entry = 'main.lisp',
  state,
  makeRuntime,
  lifecycle = 'init',
  explicitScene,
  previous = null,
  previousRequest,
  activating = false,
  restart = false,
  root = null,
}) {
  root ??= launchApplication({ files, entry, state, makeRuntime, lifecycle });
  const path = selectScene({
    explicit: explicitScene,
    requested: root.initialScene,
    previousRequest,
    active: state['active-scene'],
    activating,
  });
  const changed = restart || activating || path !== (previous?.scene?.path ?? '');
  state['entry-scene-request'] = root.initialScene ?? '';
  let outgoing = null;
  if (changed && previous?.scene?.runtime.global.exit) {
    const exitState = restart ? { ...previous.runtime.state } : state;
    const exitRoot = restart
      ? launchApplication({
          files: previous.files,
          entry,
          state: exitState,
          lifecycle: '',
          makeRuntime: () => makeRuntime(exitState),
        })
      : root;
    outgoing = stageScene(previous.files, previous.scene.path, exitRoot, () =>
      makeRuntime(exitState),
    );
    callLifecycle(outgoing.runtime, 'exit');
  }
  const scene = path ? stageScene(files, path, root, () => makeRuntime(state)) : null;
  state['active-scene'] = path;
  if (scene) {
    callLifecycle(scene.runtime, changed ? 'init' : 'reload');
    if (changed) callLifecycle(scene.runtime, 'enter');
    callHook(scene.runtime, 'update', 0);
  }
  return { runtime: root, scene, files, changed, outgoing };
}
export function updateApplication(application, dt) {
  callHook(application.runtime, 'update', dt);
  callHook(application.scene?.runtime, 'update', dt);
}
export function drawApplication(application, size) {
  const draw = application.runtime.drawFrame(...size);
  if (application.scene)
    draw.commands.push(...application.scene.runtime.drawFrame(...size).commands);
  draw.historyKey = application.scene?.runtime ?? application.runtime;
  return draw;
}

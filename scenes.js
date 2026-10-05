import { pixelHook } from './render-hooks.js';
import { resolvePath, resolveModules, cpuForms } from './module-loader.js';

export const isScenePath = (path) => typeof path === 'string' && /\.scene(?:\.lisp)?$/.test(path);
const sceneHooks = ['init', 'enter', 'exit', 'reload', 'update', 'sound'];

/** Entry requests select startup scenes and react to edits. Unrelated reloads
 * preserve transitions requested by gameplay or commands. */
export function selectScene({ explicit, requested, previousRequest, active, activating = false }) {
  if (explicit !== undefined) return explicit;
  if (activating && previousRequest === undefined) return requested ?? active ?? '';
  if ((requested ?? '') !== (previousRequest ?? '')) return requested ?? '';
  return active ?? requested ?? '';
}

/** A scene owns its functions, while project state and browser services remain
 * shared. Never overwrite the application/editor environment with scene hooks.
 * Building and validating a scene happens before the host commits its pipeline.
 */
export function stageScene(sources, path, application, makeRuntime) {
  path = resolvePath(path);
  const modules = resolveModules(sources, [path]);
  const runtime = makeRuntime();
  for (const [name, value] of Object.entries(application.global))
    if (!sceneHooks.includes(name) && !(name in runtime.global)) runtime.global[name] = value;
  for (const module of modules) runtime.load(cpuForms(module.forms));
  return { path, runtime, render: pixelHook(modules, 'render') };
}

export function callHook(runtime, name, ...args) {
  if (runtime && typeof runtime.global[name] === 'function') runtime.call(name, ...args);
}

/** Lifecycle actions are held until the host accepts the staged transition. */
export function callLifecycle(runtime, name, ...args) {
  if (!runtime) return;
  runtime.captureActions = true;
  try {
    callHook(runtime, name, ...args);
  } finally {
    runtime.captureActions = false;
  }
}

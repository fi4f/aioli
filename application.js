import { createRuntime, parse, isSym } from './lisp.js';
import { resolveModules, cpuForms } from './module-loader.js';
import { callHook, callLifecycle, selectScene } from './scenes.js';
import { applicationRender } from './render-hooks.js';

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
  for (const module of modules) {
    try {
      runtime.load(cpuForms(module.forms));
    } catch (error) {
      throw new Error(`${module.path}: ${error.message}`);
    }
  }
  callLifecycle(runtime, lifecycle);
  callHook(runtime, 'update', 0);
  runtime.render = () =>
    modules.some((module) =>
      module.forms.some(
        (form) => Array.isArray(form) && isSym(form[0], 'defpixel') && isSym(form[1], 'render'),
      ),
    )
      ? applicationRender(modules, 'render')
      : parse('(defpixel render [p time] (background "#000000"))');
  return runtime;
}

export { callHook, callLifecycle, selectScene };

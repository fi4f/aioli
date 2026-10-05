import { engineServices } from './engine-services.js';
import { resolveModules } from './module-loader.js';
import { sourceHooks } from './hook-definitions.js';
import { synthesize } from './audio.js';

/** Preview code against a private state copy with input and application actions disabled. */
export function previewHook({ files, path, name, state = {}, args, entry, resource }) {
  const modules = resolveModules(files, entry && entry !== path ? [entry, path] : [path]);
  const root = modules.find((module) => module.path === path);
  const hook = sourceHooks(root.forms).find((hook) => hook.name === name);
  if (!hook) throw new Error(`Missing preview hook ${name}`);
  args ??= hook.defaults;
  if (!Array.isArray(args) || args.length !== hook.params.length)
    throw new Error(`${name}: expected ${hook.params.length} preview arguments`);
  const services = engineServices({ size: () => hook.size, resource });
  const runtime = services.create(structuredClone(state));
  runtime.global.generator = () => null;
  for (const module of modules) runtime.load(module.forms, module.path);
  const result = { ...hook, path, args: structuredClone(args), state: runtime.state };
  if (hook.kind === 'draw') result.draw = runtime.drawFrame(...hook.size, name, args);
  else result.pcm = synthesize(runtime.collectSound(name, ...args));
  return result;
}

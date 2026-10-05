import { inspectorFields } from './inspector-fields.js';
import { isSym } from './lisp.js';
import { sourceRole } from './source-roles.js';
import { sourcePath, resolveModules, cpuForms, pixelHook } from './project.js';

/** init! owns state; an optional vector describes its inspector presentation. */
export function generatorDescriptor(path, forms) {
  const declarations = forms.filter((form) => Array.isArray(form) && isSym(form[0], 'generator'));
  if (declarations.length > 1) throw new Error(`${path}: expected one generator declaration`);
  const declaration = declarations[0];
  const output =
    declaration?.[1]?.name?.replace(/^:/, '') ??
    (forms.some((form) => isSym(form?.[0], 'defpixel') && isSym(form[1], 'image'))
      ? 'image'
      : 'audio');
  if (!['image', 'audio'].includes(output))
    throw new Error(`${path}: generator output must be :image or :audio`);
  if (
    declaration &&
    (declaration.length > 3 ||
      !isSym(declaration[1]) ||
      (declaration[2] && declaration[2].type !== 'string'))
  )
    throw new Error(`${path}: use (generator :image "Title") or (generator :audio "Title")`);
  const fields = inspectorFields(path, forms);
  return { path, title: declaration?.[2]?.value ?? path.split('/').at(-1), output, fields };
}

export function stageGenerators(sources, application, makeRuntime) {
  return Object.keys(sources)
    .map(sourcePath)
    .filter((path) => sourceRole(path) === 'generator')
    .sort()
    .map((path) => {
      const modules = resolveModules(sources, [path]);
      const root = modules.find((module) => module.path === path);
      const descriptor = generatorDescriptor(path, root.forms);
      const runtime = makeRuntime();
      for (const [name, value] of Object.entries(application.global))
        if (
          ![
            'init',
            'reload',
            'update',
            'sound',
            'generate-sound',
            'enter',
            'exit',
            'editor',
          ].includes(name) &&
          !(name in runtime.global)
        )
          runtime.global[name] = value;
      for (const module of modules) runtime.load(cpuForms(module.forms));
      if (descriptor.output === 'audio' && typeof runtime.global['generate-sound'] !== 'function')
        throw new Error(`${path}: missing (defn generate-sound [] ...)`);
      const render = descriptor.output === 'image' ? pixelHook(modules, 'image') : null;
      return { ...descriptor, runtime, render };
    });
}

export function fieldValue(field, value) {
  if (field.kind === 'number') {
    if (!Number.isFinite(value)) throw new Error('Inspector number must be finite');
    const stepped = field.low + Math.round((value - field.low) / field.step) * field.step;
    return Math.min(field.high, Math.max(field.low, Number(stepped.toPrecision(12))));
  }
  if (field.kind === 'choice' && !field.choices.includes(value))
    throw new Error('Unknown inspector choice');
  if (field.kind === 'boolean' && typeof value !== 'boolean') throw new Error('Expected a boolean');
  if (['color', 'text'].includes(field.kind) && typeof value !== 'string')
    throw new Error('Expected text');
  if (field.kind === 'color' && !/^#[\da-f]{6}$/i.test(value)) throw new Error('Expected #RRGGBB');
  return value;
}

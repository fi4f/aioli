import { policy } from './editor-policy.js';
import { literalValue, sourceMetadata } from './metadata.js';
import { inspectorFields, inspectorDeclarations } from './inspector-fields.js';
import { isSym } from './lisp.js';
import { sourceRole } from './source-roles.js';
import { sourcePath, resolveModules } from './project.js';

export function generatorDescriptor(path, forms, editor, fields) {
  const metadata = sourceMetadata(forms, path);
  const declarations = forms
    .filter((form) => isSym(form?.[0], 'generator'))
    .map((form) => form.slice(1).map(literalValue));
  return {
    ...policy('editor-generator-info', [path, declarations, metadata.definitions], editor),
    fields: fields ? inspectorDeclarations(fields, editor) : inspectorFields(path, forms, editor),
  };
}

export function stageGenerators(sources, application, makeRuntime) {
  return Object.keys(sources)
    .map(sourcePath)
    .filter((path) => sourceRole(path, application) === 'generator')
    .sort()
    .map((path) => {
      const modules = resolveModules(sources, [path]);
      const root = modules.find((module) => module.path === path);
      const runtime = makeRuntime();
      runtime.global.generator = () => null; // Editor metadata declaration, not a runtime special form.
      for (const [name, value] of Object.entries(application.global))
        if (
          ![
            'init',
            'reload',
            'update',
            'sound',
            'generate-sound',
            'generate-text',
            'enter',
            'exit',
            'editor',
            'render',
            'draw',
          ].includes(name) &&
          !(name in runtime.global)
        )
          runtime.global[name] = value;
      runtime.modules = modules;
      for (const module of modules) runtime.load(module.forms, module.path);
      const descriptor = generatorDescriptor(path, root.forms, application, [
        ...runtime.metadata.fields.values(),
      ]);
      if (descriptor.output === 'audio' && typeof runtime.global['generate-sound'] !== 'function')
        throw new Error(`${path}: missing (defn generate-sound [] ...)`);
      if (descriptor.output === 'text' && typeof runtime.global['generate-text'] !== 'function')
        throw new Error(`${path}: missing (defn generate-text [] ...)`);
      if (descriptor.output === 'image' && runtime.global.render?.hook?.kind !== 'draw')
        throw new Error(`${path}: missing (defdraw render [] ...)`);
      return { ...descriptor, runtime };
    });
}

export const fieldValue = (field, value, editor) =>
  policy('editor-field-value', [field, value], editor);

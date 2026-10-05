import { isSym } from './lisp.js';
export function pixelHook(modules, name = null) {
  const hooks = modules.flatMap((module) =>
    module.forms.filter(
      (form) =>
        Array.isArray(form) && isSym(form[0], 'defpixel') && (!name || isSym(form[1], name)),
    ),
  );
  if (hooks.length !== 1)
    throw new Error(
      name
        ? `Expected exactly one (defpixel ${name} [p time] ...) in the application or scene and its imports`
        : 'Expected exactly one defpixel hook in this scene and its imports',
    );
  return hooks;
}

/** Replace a named pixel definition without reprinting surrounding CPU code.
 * Track reader delimiters, strings and comments so parentheses in comments or
 * shader strings cannot truncate the form. Presets keep imports and annotations.
 */

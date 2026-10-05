import { isSym } from './lisp.js';
import { sourceMetadata } from './metadata.js';
import { policy } from './editor-policy.js';
export const inspectorDeclarations = (fields, editor) =>
  policy('editor-inspector-fields', [fields], editor);
export const inspectorFields = (path, forms, editor) =>
  policy('editor-inspector-fields', [sourceMetadata(forms, path).fields], editor);
export const fieldRow = (field, editor) => policy('editor-field-row', [field], editor);
export function liveFields(declared, state, owned = Object.keys(state), editor) {
  const fields = policy('editor-live-fields', [declared, state, [...owned]], editor);
  // Retain inferred ranges, rather than recomputing them as simulation values change.
  for (const field of fields)
    if (!declared.some((existing) => existing.key === field.key)) declared.push(field);
  return fields;
}
/** Literal references cover state reads and conditional drawing paths. */
export function referencedStateKeys(forms, keys = new Set()) {
  const visit = (node) => {
    if (Array.isArray(node)) {
      if (['init!', 'set!', 'get'].some((name) => isSym(node[0], name))) {
        const key =
          node[1]?.type === 'string'
            ? node[1].value
            : node[1]?.name?.startsWith(':')
              ? node[1].name.slice(1)
              : null;
        if (key) keys.add(key);
      }
      node.forEach(visit);
    } else if (node?.type === 'vector') node.items.forEach(visit);
  };
  forms.forEach(visit);
  return keys;
}

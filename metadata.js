import { validKey } from './state-values.js';
/** General declaration metadata; the engine never interprets editor annotations. */
export function literalValue(node) {
  if (typeof node === 'number') return node;
  if (node?.type === 'string') return node.value;
  if (node?.type === 'vector') return node.items.map(literalValue);
  if (node?.type === 'symbol') {
    if (node.name.startsWith(':')) return node.name.slice(1);
    if (['true', 'false', 'nil'].includes(node.name))
      return { true: true, false: false, nil: null }[node.name];
  }
  throw new Error('Annotations and defaults must be literal values');
}
export function functionInfo(form, path = '') {
  const kind = { defn: 'function', defdraw: 'draw', defsound: 'sound' }[form?.[0]?.name];
  if (!kind) return null;
  if (
    form[1]?.type !== 'symbol' ||
    form[2]?.type !== 'vector' ||
    !form[2].items.every((param) => param.type === 'symbol')
  )
    throw new Error('Use (defn/defdraw/defsound name [arguments] body...)');
  const annotated = kind !== 'function' && form[3]?.type === 'vector';
  return {
    name: form[1]?.name,
    kind,
    params: form[2]?.items.map((p) => p.name) ?? [],
    annotation: annotated ? literalValue(form[3]) : [],
    bodyOffset: annotated ? 4 : 3,
    path,
    line: form.location?.line ?? 0,
  };
}
export function stateInfo(form, path = '', key) {
  if (form?.[0]?.name !== 'init!') return null;
  if (key === undefined) {
    try {
      key = literalValue(form[1]);
    } catch {
      return null;
    }
  }
  validKey(key);
  let value,
    computed = false;
  try {
    value = literalValue(form[2]);
  } catch {
    computed = true;
    value = null;
  }
  return {
    key,
    value,
    computed,
    annotation: form[3] ? literalValue(form[3]) : [],
    path,
    line: form.location?.line ?? 0,
  };
}
export function sourceMetadata(forms, path = '') {
  return {
    definitions: forms.map((f) => functionInfo(f, path)).filter(Boolean),
    fields: forms.map((f) => stateInfo(f, path)).filter(Boolean),
  };
}

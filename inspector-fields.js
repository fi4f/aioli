import { parse, isSym } from './lisp.js';

const literal = (node) => {
  if (typeof node === 'number') return node;
  if (node?.type === 'string') return node.value;
  if (isSym(node, 'true')) return true;
  if (isSym(node, 'false')) return false;
  if (node?.type === 'vector') return node.items.map(literal);
  throw new Error('Inspector defaults and annotations must be literal values');
};

/** Shared state annotations for generator and scene inspectors. */
export function inspectorFields(path, forms) {
  const fields = [];
  for (const form of forms) {
    if (!Array.isArray(form) || !isSym(form[0], 'init!')) continue;
    const key =
      form[1]?.name?.replace(/^:/, '') ?? (form[1]?.type === 'string' ? form[1].value : '');
    if (!key || ['__proto__', 'constructor', 'prototype'].includes(key))
      throw new Error(`${path}: invalid inspector state key`);
    let value;
    try {
      value = literal(form[2]);
    } catch (error) {
      if (form[3]) throw error;
      continue; // Computed defaults can use an explicit ordinary helper module.
    }
    if (!['number', 'boolean', 'string'].includes(typeof value))
      throw new Error(`${path}: unsupported inspector default for ${key}`);
    const annotation = form[3] ? literal(form[3]) : [];
    if (
      !Array.isArray(annotation) ||
      annotation.length > 4 ||
      (annotation.length && typeof annotation[0] !== 'string')
    )
      throw new Error(`${path}: use ["Label" min max step] or ["Label" [choices...]]`);
    const label = annotation[0] ?? key;
    const choices = Array.isArray(annotation[1]) ? annotation[1] : [];
    let kind =
      typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : /^#[\da-f]{6}$/i.test(value)
            ? 'color'
            : 'text';
    if (Array.isArray(annotation[1]) && !choices.length)
      throw new Error(`${path}: inspector choices cannot be empty`);
    if (!choices.length && kind !== 'number' && annotation.length > 1)
      throw new Error(`${path}: numeric bounds only apply to numeric state`);
    if (choices.length) {
      if (
        !choices.every((choice) => typeof choice === typeof value) ||
        !choices.includes(value) ||
        annotation.length !== 2
      )
        throw new Error(`${path}: choices must include the default and match its type`);
      kind = 'choice';
    }
    const low = annotation[1] ?? Math.min(0, value - Math.max(1, Math.abs(value)));
    const high = annotation[2] ?? Math.max(1, value + Math.max(1, Math.abs(value)));
    const step = annotation[3] ?? (Number.isInteger(value) ? 1 : 0.01);
    if (
      kind === 'number' &&
      (!Number.isFinite(low) ||
        !Number.isFinite(high) ||
        low >= high ||
        !Number.isFinite(step) ||
        step <= 0 ||
        value < low ||
        value > high)
    )
      throw new Error(`${path}: invalid slider bounds/default/step for ${key}`);
    if (fields.some((field) => field.key === key))
      throw new Error(`${path}: duplicate inspector field ${key}`);
    fields.push({
      key,
      label,
      kind,
      low: kind === 'number' ? low : 0,
      high: kind === 'number' ? high : 1,
      step: kind === 'number' ? step : 1,
      choices,
      value,
    });
  }
  if (fields.length > 64) throw new Error(`${path}: maximum 64 inspector fields`);
  return fields;
}

export const fieldRow = (field) => [
  field.key,
  field.label,
  field.kind,
  field.low,
  field.high,
  field.step,
  field.choices,
];

/** Describe live fields not declared in source, including fields created by hooks. */
export function liveFields(declared, state) {
  for (const [key, value] of Object.entries(state)) {
    if (
      ['active-scene', 'entry-scene-request'].includes(key) ||
      declared.some((field) => field.key === key)
    )
      continue;
    if (!['number', 'string', 'boolean'].includes(typeof value)) continue;
    declared.push(
      ...inspectorFields(
        'live state',
        parse(`(init! ${JSON.stringify(key)} ${JSON.stringify(value)})`),
      ),
    );
  }
  return declared.filter((field) => field.key in state);
}

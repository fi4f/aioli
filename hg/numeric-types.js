const __scalarTypes__ = ['f32', 'i32', 'u32'];
const __scalarSuffixes__ = { i: 'i32', u: 'u32', f: 'f32' };
// The exact largest finite f32; the rounded decimal 3.4028235e38 overflows fround.
const __f32Maximum__ = 2 ** 128 - 2 ** 104;
const __vectorTypes__ = [2, 3, 4].flatMap((size) =>
  ['f', 'i', 'u'].map((kind) => `vec${size}${kind}`),
);
const __matrixTypes__ = [2, 3, 4].map((size) => `mat${size}x${size}f`);
const __typeAliases__ = Object.fromEntries(
  [2, 3, 4].flatMap((size) => [
    [`vec${size}`, `vec${size}f`],
    [`mat${size}`, `mat${size}x${size}f`],
  ]),
);
const __canonicalType__ = (type) =>
  typeof type === 'string'
    ? type.replace(/\b(?:vec[234]|mat[234])\b/g, (name) => __typeAliases__[name])
    : type;
const __matrixDimensions__ = Object.assign(Object.create(null), {
  mat2x2f: 2,
  mat3x3f: 3,
  mat4x4f: 4,
});
const __vectorMetadata__ = Object.create(null);
for (const size of [2, 3, 4])
  for (const [suffix, scalar] of [
    ['f', 'f32'],
    ['i', 'i32'],
    ['u', 'u32'],
  ]) {
    __vectorMetadata__[`vec${size}${suffix}`] = { size, scalar, suffix };
  }
const __matrixSize__ = (type) => (typeof type === 'string' ? __matrixDimensions__[type] || 0 : 0);
const __vectorInfo__ = (type) =>
  typeof type === 'string' ? __vectorMetadata__[type] || null : null;
function __scalarMatches__(value, type) {
  if (!Number.isFinite(value)) return false;
  if (type === 'num') return true;
  if (type === 'f32') return Object.is(value, Math.fround(value));
  if (type === 'i32') return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (type === 'u32') return Number.isInteger(value) && value >= 0 && value <= 4294967295;
  return false;
}
function __assertFinite__(value, label = 'Number') {
  if (!Number.isFinite(value)) throw new TypeError(`${label} requires a finite number`);
  return value;
}
function __convertComponent__(value, type) {
  __assertFinite__(value, type);
  if (type === 'f32')
    return Math.fround(Math.min(__f32Maximum__, Math.max(-__f32Maximum__, value)));
  if (type === 'i32' || type === 'u32') {
    const integer = Math.trunc(value) || 0;
    return type === 'i32'
      ? Math.min(2147483647, Math.max(-2147483648, integer))
      : Math.min(4294967295, Math.max(0, integer));
  }
  return value;
}

export const NumericTypes = {
  scalarTypes: __scalarTypes__,
  scalarSuffixes: __scalarSuffixes__,
  vectorTypes: __vectorTypes__,
  matrixTypes: __matrixTypes__,
  typeAliases: __typeAliases__,
  canonicalType: __canonicalType__,
  matrixSize: __matrixSize__,
  vectorInfo: __vectorInfo__,
  scalarMatches: __scalarMatches__,
  assertFinite: __assertFinite__,
  convertComponent: __convertComponent__,
};

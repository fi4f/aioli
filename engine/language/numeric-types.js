export const scalarTypes = ['f32', 'i32', 'u32'];
export const vectorTypes = [2, 3, 4].flatMap(size => ['f', 'i', 'u'].map(kind => `vec${size}${kind}`));
export const matrixTypes = [2, 3, 4].map(size => `mat${size}x${size}f`);
export const typeAliases = Object.freeze(Object.fromEntries([2, 3, 4].flatMap(size => [
  [`vec${size}`, `vec${size}f`], [`mat${size}`, `mat${size}x${size}f`],
])));
export const canonicalType = type => typeof type === 'string' ? type.replace(/\b(?:vec[234]|mat[234])\b/g, name => typeAliases[name]) : type;
const matrixDimensions = Object.freeze(Object.assign(Object.create(null), {
  mat2x2f: 2, mat3x3f: 3, mat4x4f: 4,
}));
const vectorMetadata = Object.create(null);
for (const size of [2, 3, 4]) for (const [suffix, scalar] of [['f', 'f32'], ['i', 'i32'], ['u', 'u32']]) {
  vectorMetadata[`vec${size}${suffix}`] = Object.freeze({ size, scalar, suffix });
}
Object.freeze(vectorMetadata);
export const matrixSize = type => typeof type === 'string' ? matrixDimensions[type] || 0 : 0;
export const vectorInfo = type => typeof type === 'string' ? vectorMetadata[type] || null : null;
export function scalarMatches(value, type) {
  if (typeof value !== 'number') return false;
  if (type === 'num') return true;
  if (type === 'f32') return Object.is(value, Math.fround(value)) || Number.isNaN(value);
  if (type === 'i32') return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (type === 'u32') return Number.isInteger(value) && value >= 0 && value <= 4294967295;
  return false;
}
export function convertComponent(value, type) {
  if (typeof value !== 'number') throw new TypeError(`Expected ${type} numeric component`);
  if (type === 'f32') return Math.fround(value);
  if (type === 'i32' || type === 'u32') {
    if (!Number.isFinite(value)) throw new TypeError(`${type} requires a finite number`);
    return type === 'i32' ? Math.trunc(value) | 0 : Math.trunc(value) >>> 0;
  }
  return value;
}

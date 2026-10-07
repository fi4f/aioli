export const scalarTypes = ['f32', 'i32', 'u32'];
export const vectorTypes = [2, 3, 4].flatMap(size => ['f', 'i', 'u'].map(kind => `vec${size}${kind}`));
export const matrixTypes = [2, 3, 4].map(size => `mat${size}x${size}f`);
export const typeAliases = Object.freeze(Object.fromEntries([2, 3, 4].flatMap(size => [
  [`vec${size}`, `vec${size}f`], [`mat${size}`, `mat${size}x${size}f`],
])));
export const canonicalType = type => typeof type === 'string' ? type.replace(/\b(?:vec[234]|mat[234])\b/g, name => typeAliases[name]) : type;
export const matrixSize = type => {
  const match = typeof type === 'string' && type.match(/^mat([234])x\1f$/);
  return match ? Number(match[1]) : 0;
};
export const vectorInfo = type => {
  const match = typeof type === 'string' && type.match(/^vec([234])([fiu])$/);
  return match ? { size: Number(match[1]), scalar: match[2] === 'i' ? 'i32' : match[2] === 'u' ? 'u32' : 'f32', suffix: match[2] } : null;
};
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

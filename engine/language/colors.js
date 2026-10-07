import { vector } from './data.js';
import { assertType } from './types.js';

// Straight-alpha source-over: foreground is composited over background.
export function blend(...colors) {
  if (colors.length < 1 || colors.length > 2) throw new TypeError('blend expects one or two vec4f colors in regular code; texture sampling is shader-only');
  if (colors.length === 1) colors.push(vector(4, [0, 0, 0, 1]));
  const [foreground, background] = colors.map(color => assertType(color, 'vec4f', 'blend color').values);
  if ([...foreground, ...background].some(value => !Number.isFinite(value))) throw new TypeError('blend colors must have finite components');
  const sourceAlpha = Math.min(1, Math.max(0, foreground[3]));
  const backdropAlpha = Math.min(1, Math.max(0, background[3]));
  const remaining = backdropAlpha * (1 - sourceAlpha), alpha = sourceAlpha + remaining;
  return vector(4, alpha === 0 ? [0, 0, 0, 0] : [
    ...foreground.slice(0, 3).map((value, i) => (value * sourceAlpha + background[i] * remaining) / alpha), alpha,
  ]);
}

export const blendWGSL = `fn blendColors(foreground: vec4f, background: vec4f) -> vec4f {
  let sourceAlpha = clamp(foreground.w, 0f, 1f);
  let backdropAlpha = clamp(background.w, 0f, 1f);
  let remaining = backdropAlpha * (1f - sourceAlpha);
  let alpha = sourceAlpha + remaining;
  if (alpha == 0f) { return vec4f(); }
  return vec4f((foreground.xyz * sourceAlpha + background.xyz * remaining) / alpha, alpha);
}`;

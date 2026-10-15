import { Data } from './data.js';
import { Types } from './types.js';

function __rgba__(...channels) {
  if (channels.length === 1 && Data.dataKind(channels[0]) === 'list')
    channels = [...Data.values(channels[0])];
  if (channels.length === 1) {
    const value = channels[0];
    if (value === null) return null;
    if (typeof value === 'number') channels = [value, value, value];
    else if (['vec3f', 'vec4f', 'list'].includes(Data.dataKind(value)))
      channels = [...Data.values(value)];
  }
  if (
    ![3, 4].includes(channels.length) ||
    channels.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  )
    throw new TypeError(
      'fill expects a scalar, vec3, vec4, three or four channels, or nil; channels must be between 0 and 1',
    );
  return Data.vector(4, channels.length === 3 ? [...channels, 1] : channels);
}

// Straight-alpha source-over: foreground is composited over background.
function __blend__(...colors) {
  if (colors.length < 1 || colors.length > 2)
    throw new TypeError(
      'blend expects one or two vec4f colors in regular code; texture sampling is shader-only',
    );
  if (colors.length === 1) colors.push(Data.vector(4, [0, 0, 0, 1]));
  const [foreground, background] = colors.map((color) =>
    Data.values(Types.assertType(color, 'vec4f', 'blend color')),
  );
  if ([...foreground, ...background].some((value) => !Number.isFinite(value)))
    throw new TypeError('blend colors must have finite components');
  const sourceAlpha = Math.min(1, Math.max(0, foreground[3]));
  const backdropAlpha = Math.min(1, Math.max(0, background[3]));
  const remaining = backdropAlpha * (1 - sourceAlpha),
    alpha = sourceAlpha + remaining;
  return Data.vector(
    4,
    alpha === 0
      ? [0, 0, 0, 0]
      : [
          ...foreground
            .slice(0, 3)
            .map((value, i) => (value * sourceAlpha + background[i] * remaining) / alpha),
          alpha,
        ],
  );
}

const __blendWGSL__ = `fn blendColors(foreground: vec4f, background: vec4f) -> vec4f {
  let sourceAlpha = clamp(foreground.w, 0f, 1f);
  let backdropAlpha = clamp(background.w, 0f, 1f);
  let remaining = backdropAlpha * (1f - sourceAlpha);
  let alpha = sourceAlpha + remaining;
  if (alpha == 0f) { return vec4f(); }
  return vec4f((foreground.xyz * sourceAlpha + background.xyz * remaining) / alpha, alpha);
}`;

export const Colors = { rgba: __rgba__, blend: __blend__, blendWGSL: __blendWGSL__ };

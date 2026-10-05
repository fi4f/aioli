/** Black monochrome artwork becomes a theme-tinted coverage mask. */
export function monochromeMask(pixels) {
  const result = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    result[i] = result[i + 1] = result[i + 2] = 255;
    result[i + 3] = Math.round(pixels[i + 3] * (1 - luminance / 255));
  }
  return result;
}

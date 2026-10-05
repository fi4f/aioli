/** Logical project pixels, independent of browser size and display density. */
export function canvasSize(settings = {}) {
  return [settings['canvas-width'] ?? 320, settings['canvas-height'] ?? 240].map((value) => {
    if (!Number.isInteger(value) || value < 16 || value > 2048)
      throw new Error('Canvas dimensions must be whole numbers between 16 and 2048');
    return value;
  });
}

/** Fit the logical game canvas into a browser viewport without distorting it. */
export function fitSurface(width, height, logicalWidth = 320, logicalHeight = 240) {
  const scale = Math.min(Math.max(1, width) / logicalWidth, Math.max(1, height) / logicalHeight);
  const size = [logicalWidth * scale, logicalHeight * scale];
  return { origin: [(width - size[0]) / 2, (height - size[1]) / 2], size, scale };
}

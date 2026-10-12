import hg from './hg/hg.js';

const canvas = document.getElementById('canvas');
function resizeCanvas(entry) {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const pixels = entry?.devicePixelContentBoxSize?.[0];
  const width = Math.max(1, pixels?.inlineSize ?? Math.round(bounds.width * ratio));
  const height = Math.max(1, pixels?.blockSize ?? Math.round(bounds.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return ratio;
}
const ratio = resizeCanvas();
const app = hg.App.new({
  c: canvas,
  trace: new URLSearchParams(location.search).get('trace') === '1',
});
app.state['pixel-ratio'] = ratio;
const observer = new ResizeObserver((entries) => {
  app.state['pixel-ratio'] = resizeCanvas(entries.find((entry) => entry.target === canvas));
});
try {
  observer.observe(canvas, { box: 'device-pixel-content-box' });
} catch {
  observer.observe(canvas);
}
const density = { media: null };
function watchDensity() {
  density.media?.removeEventListener('change', watchDensity);
  app.state['pixel-ratio'] = resizeCanvas();
  density.media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  density.media.addEventListener('change', watchDensity);
}
watchDensity();
function dispose() {
  observer.disconnect();
  density.media?.removeEventListener('change', watchDensity);
  hg.App.dispose(app);
}
const url = new URL('./editor/main.lisp', import.meta.url);
try {
  await hg.App.load(app, url.href);
} catch (error) {
  console.error(error);
  dispose();
}
window.addEventListener('pagehide', dispose, { once: true });

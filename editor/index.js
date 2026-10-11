import hg from '../hg/hg.js';

const canvas = document.getElementById('canvas');
function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}
resizeCanvas();
const observer = new ResizeObserver(resizeCanvas);
observer.observe(canvas);
const app = hg.App.new({ c: canvas });
const url = new URL('./main.lisp', import.meta.url);
try {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
  await hg.App.serve(app, await response.text(), { sourceURL: url.href });
} catch (error) {
  console.error(error);
  observer.disconnect();
  hg.App.dispose(app);
}
window.addEventListener(
  'pagehide',
  () => {
    observer.disconnect();
    hg.App.dispose(app);
  },
  { once: true },
);

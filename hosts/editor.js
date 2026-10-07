import { Aioli } from '../aioli.js';

// Host only boots the Lisp application. No visible DOM editor UI.
const canvas = document.getElementById('canvas');
const runtime = new Aioli();
try {
  await runtime.attach(canvas);
  await runtime.load(new URL('../editor/main.lisp', import.meta.url).href);
} catch (error) {
  console.error(error);
  runtime.destroy();
}
window.addEventListener('pagehide', () => {
  runtime.destroy();
}, { once: true });

import hg from './hg/hg.js';

const source = document.getElementById('source');
const run = document.getElementById('run');
const patch = document.getElementById('patch');
const error = document.getElementById('error');
const app = hg.App.new({ c: 'canvas' });

async function replaceScene(replace) {
  error.textContent = '';
  try {
    await replace(app, source.value);
  } catch (failure) {
    error.textContent = failure.message;
  }
}

run.addEventListener('click', () => replaceScene(hg.App.serve));
patch.addEventListener('click', () => replaceScene(hg.App.patch));

app.ready.catch((failure) => {
  error.textContent = failure.message;
});
window.addEventListener('pagehide', () => hg.App.dispose(app), { once: true });

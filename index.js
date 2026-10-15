import hg from './hg.js';
import { Modules } from './hg/modules.js';
import { Data } from './hg/data.js';
import { resourceResponse } from './hg/resources.js';
import { VfsSeed } from './hg/vfs-seed.generated.js';
import { Trace } from './hg/trace.js';

const host = {
  app: null,
  fs: null,
  api: null,
  project: null,
  trusted: null,
  ready: false,
  recovery:
    new URLSearchParams(location.search).has('recovery') ||
    new URLSearchParams(location.search).get('editor') === 'repository',
  request: 0,
  error: '',
  saved: null,
  session: null,
  checkpointError: '',
};
const canvas = document.getElementById('canvas');
const errorPanel = document.getElementById('host-error');
const loading = document.getElementById('host-loading');
const loadingStatus = document.getElementById('host-loading-status');
function reportError(error) {
  console.error(error);
  host.error = Trace.formatTrace(error instanceof Error ? error : new Error(error?.message ?? String(error)));
  document.getElementById('host-diagnostic').textContent = host.error;
  errorPanel.hidden = false;
  loading.hidden = true;
  canvas.setAttribute('aria-busy', 'false');
}
document.getElementById('host-recover').addEventListener('click', () => {
  void boot(true).catch(reportError);
});
const store = hg.Storage.new('mercury-project');
const baseURL = new URL('./', import.meta.url).href;
const internalURL = 'vfs://mercury/';
const repositoryURL = new URL('./editor/main.lisp', import.meta.url).href;
const member = (namespace, name) => Data.get(namespace, name);
const call = (namespace, name, ...args) => member(namespace, name)(...args);
function checkpointState(project) {
  const app = host.app;
  if (!host.session || !app?.scene || app.destroyed) return;
  try {
    call(host.trusted.project, 'checkpoint', host.session, call(project, 'capture', app.state));
    host.checkpointError = '';
  } catch (error) {
    const message = `Unable to preserve the editor session: ${error.message}`;
    if (message !== host.checkpointError) {
      host.checkpointError = message;
      reportError(new Error(message));
    }
  }
}
function checkpoint() {
  checkpointState(host.app?.failed || host.app?.inputFailed ? host.trusted?.project : host.project);
}
const checkpointTimer = window.setInterval(checkpoint, 500);
function visibilityChanged() {
  if (document.visibilityState === 'hidden') checkpoint();
}
document.addEventListener('visibilitychange', visibilityChanged);
// Installed before any project Lisp; native textarea input cannot swallow F2.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'F2') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    host.recovery = true;
    if (host.ready || host.app?.graphics) void boot(true).catch(reportError);
  },
  { capture: true },
);
function resizeCanvas(entry) {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const pixels = entry?.devicePixelContentBoxSize?.[0];
  const width = Math.max(1, pixels?.inlineSize ?? Math.round(bounds.width * ratio));
  const height = Math.max(1, pixels?.blockSize ?? Math.round(bounds.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  if (host.app) host.app.state['pixel-ratio'] = ratio;
  return ratio;
}
const observer = new ResizeObserver((entries) =>
  resizeCanvas(entries.find((entry) => entry.target === canvas)),
);
try {
  observer.observe(canvas, { box: 'device-pixel-content-box' });
} catch {
  observer.observe(canvas);
}
const density = { media: null };
function watchDensity() {
  density.media?.removeEventListener('change', watchDensity);
  resizeCanvas();
  density.media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  density.media.addEventListener('change', watchDensity);
}
watchDensity();
async function defaultFiles() {
  const base = new URL('./hg/vfs-seed.generated.js', import.meta.url);
  return Promise.all(
    VfsSeed.map(async (file) => {
      const resource = await hg.Resources.fetch(new URL(file.source, base).href);
      hg.Resources.require(
        resource.ok,
        `Unable to fetch default ${file.path}: HTTP ${resource.status}`,
      );
      return {
        path: file.path,
        text: file.text,
        resource: {
          status: 200,
          ok: true,
          mime: file.mime,
          encoding: resource.encoding,
          data: resource.data,
          size: resource.size,
        },
      };
    }),
  );
}
async function fetchDefaults() {
  try {
    host.defaults = await defaultFiles();
  } catch (error) {
    if (!host.defaults) throw error;
    console.error('Using cached defaults', error);
  }
  return host.defaults;
}
async function legacyFiles() {
  // Read the old format once. All filesystem policy and writes belong to Lisp.
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('hg-vfs:mercury');
    request.onupgradeneeded = () => {
      request.transaction.abort(); // An absent legacy database stays absent.
      request.result.close();
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      request.onsuccess = () => request.result.close();
      reject(new Error('Legacy files are blocked by another page'));
    };
  });
  if (!database) return [];
  try {
    const { entries, contents } = await new Promise((resolve, reject) => {
      const tx = database.transaction(['entries', 'contents']);
      const entries = tx.objectStore('entries').getAll();
      const keys = tx.objectStore('contents').getAllKeys();
      const values = tx.objectStore('contents').getAll();
      tx.oncomplete = () => resolve({ entries: entries.result,
        contents: new Map(keys.result.map((key, index) => [key, values.result[index]])) });
      tx.onabort = () => reject(tx.error ?? new Error('Unable to read legacy files'));
    });
    return await Promise.all(entries.filter(entry => entry.path !== '/').map(async entry => {
      if (entry.kind === 'directory') return entry;
      const blob = contents.get(entry.path);
      if (!(blob instanceof Blob)) throw new Error(`Missing legacy contents: ${entry.path}`);
      return { path: entry.path, text: entry.text,
        resource: hg.Resources.fromBytes(Array.from(new Uint8Array(await blob.arrayBuffer())), entry.mime) };
    }));
  } finally {
    database.close();
  }
}
function configure(app) {
  const alive = () => {
    if (host.app !== app || app.destroyed) throw new Error('Editor instance is no longer active');
  };
  app.bindings['editor-resume'] = () => {
    alive();
    return boot(false);
  };
  app.bindings['editor-default-files'] = async () =>
    (await fetchDefaults()).filter((file) => file.path.startsWith('/editor/'));
  app.bindings['project-default-files'] = fetchDefaults;
  app.bindings['project-base-url'] = () => baseURL;
  // Existing customized editors can keep their former explicit update action.
  app.bindings['editor-update-bundle'] = async () => {
    alive();
    const files = await app.bindings['editor-default-files']();
    alive();
    return call(host.trusted.project, 'resetEditor', host.fs, files);
  };
  app.bindings['project-reload'] = () => {
    alive();
    host.saved = null;
    return boot(false, false);
  };
  app.bindings['editor-recover'] = () => {
    alive();
    return boot(true);
  };
  app.state['pixel-ratio'] = resizeCanvas();
  app.state['editor-mode'] = host.recovery ? 'recovery' : 'saved';
  app.state['editor-entry'] = host.recovery
    ? repositoryURL
    : call(host.api, 'url', host.fs, '/editor/main.lisp');
  if (host.error) app.state['boot-error'] = host.error;
}
async function trusted(app) {
  const fsModule = await Modules.import(
    app.modules,
    new URL('./editor/vfs.lisp', import.meta.url).href,
  );
  const projectModule = await Modules.import(
    app.modules,
    new URL('./editor/project.lisp', import.meta.url).href,
  );
  return {
    fs: member(fsModule, 'FileSystem'),
    project: member(projectModule, 'Project'),
  };
}
function bundledResource(url) {
  const address = new URL(url);
  address.hash = '';
  address.search = '';
  const base = new URL('./hg/vfs-seed.generated.js', import.meta.url);
  const file = VfsSeed.find((file) => new URL(file.source, base).href === address.href);
  return file ? host.defaults?.find((entry) => entry.path === file.path)?.resource : null;
}
async function boot(recovery, capture = true) {
  const request = ++host.request;
  if (capture) checkpointState(host.trusted?.project);
  host.session = null;
  host.ready = false;
  errorPanel.hidden = true;
  loading.hidden = false;
  loadingStatus.textContent = recovery ? 'Opening recovery editor…' : 'Opening your project…';
  canvas.setAttribute('aria-busy', 'true');
  host.recovery = recovery;
  const previous = host.app;
  if (previous) {
    // Never execute a potentially broken project save hook during recovery.
    if (capture) {
      try {
        host.saved = JSON.parse(
          Data.dataBindings['to-json'](call(host.trusted.project, 'capture', previous.state)),
        );
      } catch {
        /* Retain the last explicitly saved state. */
      }
    }
    hg.App.abandon(previous);
    host.app = null;
  }
  const app = hg.App.new({
    c: canvas,
    trace: new URLSearchParams(location.search).get('trace') === '1',
  });
  host.app = app;
  app.onError = (error) => {
    if (host.app !== app || app.destroyed) return;
    if (app.failed)
      for (const proxy of [...app.textProxies]) hg.TextProxy.dispose(proxy);
    reportError(error);
  };
  try {
    await app.ready;
    if (host.recovery && !recovery) return boot(true);
    const records = await hg.Storage.records(store);
    if (request !== host.request) return;
    // The pristine bundle is independent of the current project's adapter and files.
    if (records.defaults && !host.defaults) host.defaults = records.defaults;
    try {
      const defaults = await defaultFiles();
      if (request !== host.request) return;
      host.defaults = defaults;
    } catch (error) {
      if (request !== host.request) return;
      if (!host.defaults) throw error;
      host.error = `Using cached defaults: ${error.message}`;
    }
    if (JSON.stringify(host.defaults) !== JSON.stringify(records.defaults))
      await hg.Storage.commit(store, store.version, [
        { kind: 'put', key: 'defaults', value: host.defaults },
      ]);
    if (request !== host.request) return;
    app.modules.fetch = async (url) => {
      const cached = bundledResource(url);
      return cached ? resourceResponse(cached) : fetch(url, { cache: 'no-store' });
    };
    const tools = await trusted(app);
    if (request !== host.request) return;
    host.trusted = tools;
    const fs = await call(
      tools.fs,
      'new',
      store,
      recovery ? baseURL : records.project?.assetURL || baseURL,
      internalURL,
    );
    if (!records.index) {
      const legacy = await legacyFiles();
      if (legacy.length) await call(tools.project, 'migrate', fs, legacy, host.defaults);
      else await call(tools.project, 'create', fs, host.defaults);
    }
    host.fs = fs;
    host.api = tools.fs;
    host.project = tools.project;
    hg.App.setFilesystem(app, fs, tools.fs);
    if (recovery) {
      const projectFetch = app.modules.fetch;
      app.modules.fetch = (url, options) => {
        const resource = bundledResource(url);
        return resource ? Promise.resolve(resourceResponse(resource)) : projectFetch(url, options);
      };
    }
    if (!recovery) {
      const fsModule = await Modules.import(
        app.modules,
        call(tools.fs, 'url', fs, '/editor/vfs.lisp'),
      );
      const api = member(fsModule, 'FileSystem');
      const projectFs = await call(api, 'new', store, fs.project.assetURL || baseURL, internalURL);
      hg.App.setFilesystem(app, projectFs, api);
      host.fs = projectFs;
      host.api = api;
      const projectModule = await Modules.import(
        app.modules,
        call(api, 'url', projectFs, '/editor/project.lisp'),
      );
      host.project = member(projectModule, 'Project');
    }
    if (request !== host.request) return;
    try {
      const saved = host.saved ||
        (await call(tools.project, 'sessionState', store, host.fs)) || host.fs.project.state || {};
      app.state = await call(
        host.project,
        'restore',
        host.fs,
        saved,
      );
    } catch (error) {
      if (!recovery) throw error;
      app.state = {
        editor: {
          source: '',
          path: '',
          'saved-source': '',
          anchor: 0,
          head: 0,
          scroll: 0,
          'scroll-x': 0,
          version: 0,
          composing: false,
          pending: false,
          elapsed: 0,
          error: '',
          auto: false,
          locked: true,
        },
      };
      host.error = `Saved editor state could not restore: ${error.message}`;
    }
    if (request !== host.request || app.destroyed) return;
    host.session = call(tools.project, 'newSession', store, host.fs);
    configure(app);
    loadingStatus.textContent = 'Restoring your workspace…';
    await hg.App.load(app, app.state['editor-entry']);
    if (request !== host.request) return;
    const address = new URL(location.href);
    address.searchParams.delete('editor');
    if (recovery) address.searchParams.set('recovery', '1');
    else address.searchParams.delete('recovery');
    history.replaceState(null, '', address);
    host.ready = true;
    loading.hidden = true;
    canvas.setAttribute('aria-busy', 'false');
  } catch (error) {
    console.error(error);
    if (request !== host.request) return;
    host.error = error.message;
    if (!recovery) return boot(true);
    host.ready = true;
    throw error;
  }
}
function dispose() {
  checkpoint();
  window.clearInterval(checkpointTimer);
  document.removeEventListener('visibilitychange', visibilityChanged);
  host.request++;
  observer.disconnect();
  density.media?.removeEventListener('change', watchDensity);
  if (host.app) hg.App.abandon(host.app);
  hg.Storage.close(store);
}
window.addEventListener('pagehide', dispose, { once: true });
try {
  await store.ready;
  await boot(host.recovery);
} catch (error) {
  reportError(error);
}

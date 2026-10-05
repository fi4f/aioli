/** Embed a closed ES-module graph and project files into a single offline HTML.
 * Blob module URLs are created locally; no server, fetch, or build step is used
 * by the exported application. Project paths and dynamic imports remain intact. */
export async function exportHTML(
  files,
  resources = {},
  load = async (path) => {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`Cannot bundle ${path}: HTTP ${response.status}`);
    return response.text();
  },
  settings = {},
) {
  const modules = Object.create(null);
  async function collect(path) {
    if (path in modules) return;
    const source = await load(path);
    modules[path] = source;
    const dependencies = [
      ...source.matchAll(/^(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"](\.\/[^'"]+)['"]/gm),
    ].map((match) => match[1].slice(2));
    await Promise.all(dependencies.map(collect));
  }
  await collect('standalone.js');
  const project = {
    settings,
    files: { ...files, 'main.lisp': '(import "./game.lisp")' },
    resources,
  };
  const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aioli application</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}canvas{display:block;width:100%;height:100%}#error{position:absolute;top:0;left:0;color:white;background:#600;white-space:pre-wrap}</style>
<canvas id="app" tabindex="0"></canvas><div id="error" role="alert"></div>
<script type="module">
const sources=${json(modules)}, project=${json(project)}, urls=new Map();
function moduleURL(path) {
  if (urls.has(path)) return urls.get(path);
  const source=sources[path].replace(/^((?:import|export)\\s+(?:[^;]*?\\s+from\\s*)?)(['"])(\\.\\/[^'"]+)\\2/gm,
    (_, prefix, quote, dependency) => prefix + quote + moduleURL(dependency.slice(2)) + quote);
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  urls.set(path,url); return url;
}
try {
  const {startApplication}=await import(moduleURL('standalone.js'));
  await startApplication(project,document.getElementById('app'));
} catch(error) {document.getElementById('error').textContent=error.message;}
</script></html>`;
}

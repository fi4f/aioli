import { resolvePath, resolveModules as loadModules } from './module-loader.js';
import { validateState } from './state-values.js';
import { normalizeSource } from './source-text.js';
import { canvasSize } from './canvas-size.js';
import { projectName } from './project-settings.js';
import { sourcePath, sourceKey } from './project-paths.js';
export { sourcePath, sourceKey, resolvePath };
export const entryPaths = { main: 'main.lisp', game: 'game.lisp' };
export function rolePath(sources, role, required = false) {
  const path = role === 'app' && typeof sources.main === 'string' ? 'main.lisp' : '';
  if (!path && required) throw new Error('Missing main.lisp entry file');
  return path;
}
export function resolveModules(sources, roots) {
  return loadModules(
    Object.fromEntries(Object.entries(sources).map(([key, text]) => [sourcePath(key), text])),
    roots.map(sourcePath),
  );
}
export function projectSnapshot(
  sources,
  state,
  resources = {},
  recovery = false,
  applicationState = {},
) {
  return {
    version: 1,
    files: Object.fromEntries(
      Object.entries(sources)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, text]) => [sourcePath(key), normalizeSource(text)]),
    ),
    resources,
    state: Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('__scene-'))),
    applicationState,
    recovery,
  };
}
/** Current format only. No historical aliases, seed merging or migrations. */
export function readProject(project) {
  if (
    project?.version !== 1 ||
    !project.files ||
    typeof project.files !== 'object' ||
    Array.isArray(project.files) ||
    Object.keys(project.files).length > 256
  )
    throw new Error('Not a current aioli project');
  validateState(project.state);
  validateState(project.applicationState ?? {});
  canvasSize(project.state);
  projectName(project.state);
  const sources = Object.create(null),
    resources = project.resources ?? {};
  for (const [path, text] of Object.entries(project.files)) {
    if (
      resolvePath(path) !== path ||
      path.startsWith('__') ||
      typeof text !== 'string' ||
      text.length > 100000
    )
      throw new Error(`Invalid source ${path}`);
    sources[sourceKey(path)] = normalizeSource(text);
  }
  if (
    !resources ||
    typeof resources !== 'object' ||
    Array.isArray(resources) ||
    Object.keys(resources).length > 256
  )
    throw new Error('Invalid resources');
  for (const [path, resource] of Object.entries(resources)) {
    if (
      resolvePath(path) !== path ||
      sourceKey(path) in sources ||
      !resource ||
      typeof resource.mime !== 'string' ||
      !/^[\w.+-]+\/[\w.+-]+(?:;charset=[\w.-]+)?$/.test(resource.mime) ||
      typeof resource.data !== 'string' ||
      !/^data:[\w/+.-]+(?:;charset=[\w.-]+)?;base64,[A-Za-z0-9+/]*={0,2}$/.test(resource.data) ||
      resource.data.length > 8000256 ||
      (resource.source !== undefined && resolvePath(resource.source) !== resource.source)
    )
      throw new Error(`Invalid resource ${path}`);
  }
  if (project.recovery !== undefined && typeof project.recovery !== 'boolean')
    throw new Error('Invalid recovery flag');
  return {
    sources,
    resources,
    state: project.state,
    applicationState: project.applicationState ?? {},
    recovery: project.recovery ?? false,
  };
}

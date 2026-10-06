import { canvasSize } from './canvas-size.js';

export function projectName(settings = {}) {
  const name = settings['project-name'] ?? 'Untitled project';
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 120 ||
    /[\r\n\x00-\x1f]/.test(name)
  )
    throw new Error('Project name must be 1 to 120 characters on one line');
  return name.trim();
}

export function projectSettings(settings = {}) {
  const [width, height] = canvasSize(settings);
  return { 'project-name': projectName(settings), 'canvas-width': width, 'canvas-height': height };
}

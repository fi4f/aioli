import { policy } from './editor-policy.js';
export const newFilePath = (path, type = 'script', editor) =>
  policy('editor-new-file-path', [path, type], editor);
export const newFileCode = (type = 'script', output = 'image', editor) =>
  policy('editor-new-file-code', [type, output], editor);

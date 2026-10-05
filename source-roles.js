import { policy } from './editor-policy.js';
export const sourceRole = (path, editor) => policy('editor-source-role', [path], editor);
export const isScenePath = (path, editor) => sourceRole(path, editor) === 'scene';

import { policy } from './editor-policy.js';
/** Generate once per declared parameter change, retaining errors for the preview. */
export function textOutput(program, force = false) {
  if (!program || program.output !== 'text') throw new Error('Select a text generator');
  const signature = () =>
    JSON.stringify(program.fields.map((field) => program.runtime.state[field.key]));
  if (!force && program.textBuffer?.signature === signature()) return program.textBuffer;
  let text = '',
    error = '';
  try {
    text = program.runtime.call('generate-text');
    if (typeof text !== 'string') throw new Error('generate-text must return a string');
    if (new TextEncoder().encode(text).length > 6000000)
      throw new Error('Generated text exceeds 6MB');
  } catch (e) {
    text = '';
    error = e.message;
  }
  const lines = (error || text).replace(/\r\n?/g, '\n').split('\n');
  const width = lines.reduce((max, line) => Math.max(max, line.length * 8 + 8), 0);
  return (program.textBuffer = { text, error, lines, width, signature: signature() });
}
export const textMime = (path, editor) => policy('editor-text-mime', [path], editor);

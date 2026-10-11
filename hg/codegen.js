// Escape delimiters as well as lines; WGSL permits nested block comments.
const __nameComment__ = (name) =>
  `/* ${JSON.stringify(name).replaceAll('/*', '\\u002f*').replaceAll('*/', '*\\u002f')} */`;

export const Codegen = { nameComment: __nameComment__ };

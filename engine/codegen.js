// Escape delimiters as well as lines; WGSL permits nested block comments.
export const nameComment = name => `/* Lisp: ${JSON.stringify(name).replaceAll('/*', '\\u002f*').replaceAll('*/', '*\\u002f')} */`;

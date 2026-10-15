import { Data } from './data.js';

const __string__ = (value) => {
  if (typeof value !== 'string') throw new TypeError('Expected a string');
  return value;
};
export const Strings = Data.registerHostData({
  split: (text, separator) => __string__(text).split(__string__(separator)),
  join: (items, separator) => items.map(__string__).join(__string__(separator)),
  slice: (text, start, end) => __string__(text).slice(start, end ?? undefined),
  starts: (text, prefix) => __string__(text).startsWith(__string__(prefix)),
  has: (text, part) => __string__(text).includes(__string__(part)),
  lower: (text) => __string__(text).toLowerCase(),
  replace: (text, from, to) => __string__(text).replaceAll(__string__(from), __string__(to)),
  lastIndex: (text, part) => __string__(text).lastIndexOf(__string__(part)),
  sorted: (items) => items.map(__string__).sort(),
  clean: (text) => !/[\\\u0000-\u001f\u007f]/u.test(__string__(text)),
  encode: (text) => encodeURIComponent(__string__(text)),
});

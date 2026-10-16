import { Data } from './data.js';
import { Types } from './types.js';
import { NumericTypes } from './numeric-types.js';

// Rectangle geometry shared by text rasterization and editable Lisp layout.
// Flow, wrapping, component measurement, and interaction stay with their callers.
function __paddingValues__(value) {
  const values =
    typeof value === 'number'
      ? [value, value]
      : Data.dataKind(value) === 'vec2f'
        ? Data.values(value)
        : null;
  if (values?.length !== 2 || values.some((v) => !Number.isFinite(v) || v < 0))
    throw new TypeError('padding expects a finite nonnegative scalar or vec2');
  for (let i = 0; i < 2; i++) values[i] = NumericTypes.convertComponent(values[i], 'f32');
  return values;
}
function __padding__(value = 0) {
  return Data.numericFromComponents('vec2f', __paddingValues__(value));
}

function __inset__(bounds, padding = 0) {
  Types.assertType(bounds, 'vec4f', 'rectangle bounds');
  const [x, y] = __paddingValues__(padding);
  return Data.vector(4, [
    bounds.x + x,
    bounds.y + y,
    Math.max(0, bounds.z - 2 * x),
    Math.max(0, bounds.w - 2 * y),
  ]);
}

function __offset__(available, extent, alignment) {
  if (!Number.isFinite(available) || !Number.isFinite(extent))
    throw new TypeError('Rectangle alignment expects finite dimensions');
  if (['left', 'top', 'start', 'stretch'].includes(alignment)) return 0;
  if (alignment === 'center') return (available - extent) / 2;
  if (['right', 'bottom', 'end'].includes(alignment)) return available - extent;
  throw new TypeError(`Unknown rectangle alignment: ${alignment}`);
}

function __align__(bounds, extent, horizontal = 'left', vertical = 'top') {
  Types.assertType(bounds, 'vec4f', 'rectangle bounds');
  Types.assertType(extent, 'vec2f', 'rectangle extent');
  const width = horizontal === 'stretch' ? bounds.z : extent.x;
  const height = vertical === 'stretch' ? bounds.w : extent.y;
  return Data.vector(4, [
    bounds.x + __offset__(bounds.z, width, horizontal),
    bounds.y + __offset__(bounds.w, height, vertical),
    width,
    height,
  ]);
}

export const Layout = {
  padding: __padding__,
  inset: __inset__,
  align: __align__,
  offset: __offset__,
};

/** A bounded, immutable grid embedded in a pixel program; cells are material IDs. */
export function gridRayShader(rows) {
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 64 ||
    typeof rows[0] !== 'string' ||
    !rows[0].length ||
    rows[0].length > 64 ||
    rows.some(
      (row) => typeof row !== 'string' || row.length !== rows[0].length || !/^[0-9]+$/.test(row),
    )
  )
    throw new Error('grid-ray expects a rectangular grid of 1–64 rows/columns containing digits');
  const width = rows[0].length,
    height = rows.length;
  // Encoding the grid itself avoids hash collisions between shaders in one draw list.
  const name = `gridRay_${width}_${rows.join('_')}`;
  const cells = rows
    .join('')
    .split('')
    .map((cell) => `${cell}u`)
    .join(',');
  const code = `fn ${name}(origin: vec2f, ray: vec2f) -> vec4f {
    if (all(abs(ray) < vec2f(0.00001))) { return vec4f(10000.0, 0.0, 0.0, 0.0); }
    let cells = array<u32, ${width * height}>(${cells});
    var cell = vec2i(floor(origin));
    let delta = 1.0 / max(abs(ray), vec2f(0.00001));
    let direction = select(vec2i(1), vec2i(-1), ray < vec2f(0.0));
    var next = select(vec2f(cell) + vec2f(1.0) - origin, origin - vec2f(cell), ray < vec2f(0.0)) * delta;
    var distance = 0.0;
    var side = 0.0;
    for (var i = 0u; i < ${width + height + 2}u; i++) {
      if (next.x < next.y) {
        distance = next.x; next.x += delta.x; cell.x += direction.x; side = 0.0;
      } else {
        distance = next.y; next.y += delta.y; cell.y += direction.y; side = 1.0;
      }
      var material = 1u;
      if (cell.x >= 0 && cell.y >= 0 && cell.x < ${width} && cell.y < ${height}) {
        material = cells[u32(cell.y * ${width} + cell.x)];
      }
      if (material != 0u) {
        let point = origin + distance * ray;
        return vec4f(distance, side, f32(material), fract(select(point.y, point.x, side > 0.5)));
      }
    }
    return vec4f(10000.0, 0.0, 0.0, 0.0);
  }`;
  return { name, code };
}

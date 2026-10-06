const edges = ['left', 'right', 'top', 'bottom'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function leaves(tree) {
  return !tree
    ? []
    : typeof tree === 'string'
      ? [tree]
      : [...leaves(tree.first), ...leaves(tree.second)];
}
export function removeLeaf(tree, id) {
  if (!tree || typeof tree === 'string') return tree === id ? null : tree;
  const first = removeLeaf(tree.first, id),
    second = removeLeaf(tree.second, id);
  return !first ? second : !second ? first : { ...tree, first, second };
}
export function splitLeaf(tree, target, id, edge) {
  if (typeof tree === 'string') return tree === target ? joinTree(tree, id, edge, 0.5) : tree;
  if (!tree) return id;
  return {
    ...tree,
    first: splitLeaf(tree.first, target, id, edge),
    second: splitLeaf(tree.second, target, id, edge),
  };
}
export function joinTree(tree, id, edge, fraction = 0.3) {
  if (!tree) return id;
  const before = edge === 'left' || edge === 'top';
  return {
    axis: edge === 'left' || edge === 'right' ? 'x' : 'y',
    ratio: before ? fraction : 1 - fraction,
    first: before ? id : tree,
    second: before ? tree : id,
  };
}
export function setRatio(tree, path, ratio) {
  if (!path.length) return { ...tree, ratio };
  const side = path[0] === 0 ? 'first' : 'second';
  return { ...tree, [side]: setRatio(tree[side], path.slice(1), ratio) };
}

/** Capture the existing edge layout as a bounded, serializable split tree. */
export function treeFromEntries(entries, placements, origin, size) {
  const docked = entries.filter(
    ([pane]) =>
      pane.options?.fixed || (placements[pane.id]?.dock ?? pane.options?.dock) !== 'floating',
  );
  function build(index, remaining) {
    if (index >= docked.length) return null;
    const [pane, , bounds] = docked[index];
    const opts = pane.options ?? {};
    let edge = placements[pane.id]?.dock ?? opts.dock ?? 'left';
    if (opts.fixed) edge = 'center';
    if (!edges.includes(edge)) {
      const tail = build(index + 1, remaining);
      return tail ? joinTree(tail, pane.id, 'left', 0.5) : pane.id;
    }
    const axis = edge === 'left' || edge === 'right' ? 0 : 1;
    const fraction = remaining[axis] > 0 ? bounds[axis] / remaining[axis] : 0.5;
    const next = [...remaining];
    next[axis] -= bounds[axis];
    return joinTree(build(index + 1, next), pane.id, edge, fraction);
  }
  return build(0, size);
}

export function completeTree(tree, panes, placements, size) {
  let count = 0;
  const seen = new Set();
  function check(node, depth = 0) {
    if (!node) return;
    if (++count > 31 || depth > 16) throw new Error('Dock layout exceeds 16 panes');
    if (typeof node === 'string') {
      if (seen.has(node)) throw new Error(`Duplicate dock leaf ${node}`);
      seen.add(node);
      return;
    }
    if (!['x', 'y'].includes(node.axis) || !Number.isFinite(node.ratio))
      throw new Error('Invalid dock split');
    check(node.first, depth + 1);
    check(node.second, depth + 1);
  }
  check(tree);
  for (const pane of panes.filter(Boolean)) {
    if (
      pane.visible === false ||
      (!pane.options?.fixed && (placements[pane.id]?.dock ?? pane.options?.dock) === 'floating') ||
      seen.has(pane.id)
    )
      continue;
    const opts = pane.options ?? {},
      edge = placements[pane.id]?.dock ?? opts.dock ?? 'right';
    const axis = edge === 'top' || edge === 'bottom' ? 1 : 0;
    const extent = opts.extent ?? 0.3;
    const fraction = extent <= 1 ? extent : extent / Math.max(1, size[axis]);
    tree = joinTree(
      tree,
      pane.id,
      edges.includes(edge) ? edge : 'right',
      clamp(fraction, 0.1, 0.8),
    );
    seen.add(pane.id);
  }
  return tree;
}

/** Hidden/floating leaves disappear for layout without destroying saved splits. */
export function arrangeTree(tree, panes, placements, origin, size) {
  const byId = new Map(panes.filter(Boolean).map((pane) => [pane.id, pane]));
  const result = [],
    dividers = [];
  function minimum(node) {
    if (typeof node === 'string') {
      const pane = byId.get(node);
      if (
        !pane ||
        pane.visible === false ||
        pane.options?.collapsed ||
        (!pane.options?.fixed && (placements[node]?.dock ?? pane.options?.dock) === 'floating')
      )
        return null;
      return [120, 80];
    }
    if (!node) return null;
    const a = minimum(node.first),
      b = minimum(node.second);
    if (!a) return b;
    if (!b) return a;
    return node.axis === 'x'
      ? [a[0] + b[0], Math.max(a[1], b[1])]
      : [Math.max(a[0], b[0]), a[1] + b[1]];
  }
  function arrange(node, rect, path = []) {
    if (!minimum(node)) return;
    if (typeof node === 'string') {
      result.push([byId.get(node), rect.slice(0, 2), rect.slice(2)]);
      return;
    }
    const a = minimum(node.first),
      b = minimum(node.second);
    if (!a) {
      arrange(node.second, rect, [...path, 1]);
      return;
    }
    if (!b) {
      arrange(node.first, rect, [...path, 0]);
      return;
    }
    const axis = node.axis === 'x' ? 0 : 1,
      total = rect[axis + 2];
    const minA = Math.min(a[axis], (total * a[axis]) / (a[axis] + b[axis]));
    const minB = Math.min(b[axis], (total * b[axis]) / (a[axis] + b[axis]));
    const amount = clamp(total * node.ratio, minA, total - minB);
    const first = [...rect],
      second = [...rect];
    first[axis + 2] = amount;
    second[axis] += amount;
    second[axis + 2] -= amount;
    {
      const handle = [...rect];
      handle[axis] += amount - 3;
      handle[axis + 2] = 6;
      dividers.push({
        axis: node.axis,
        path,
        container: rect,
        rect: handle,
        owners: [...leaves(node.first), ...leaves(node.second)],
        minA,
        minB,
      });
    }
    arrange(node.first, first, [...path, 0]);
    arrange(node.second, second, [...path, 1]);
  }
  arrange(tree, [...origin, ...size]);
  return { entries: result, dividers };
}

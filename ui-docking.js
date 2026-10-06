import { policy } from './editor-policy.js';
import {
  arrangeTree,
  completeTree,
  treeFromEntries,
  removeLeaf,
  setRatio,
} from './ui-dock-tree.js';
const edges = ['left', 'right', 'top', 'bottom'];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const number = (n, fallback) => (Number.isFinite(n) ? n : fallback);
const isFloating = (pane, placements) =>
  !pane.options?.fixed && (placements[pane.id]?.dock ?? pane.options?.dock) === 'floating';

/** Saved placements contain only JSON values; pane content stays in Lisp. */
function edgeDockLayout(placements, panes, origin, size) {
  if (panes.length > 16 || ![...origin, ...size].every(Number.isFinite))
    throw new Error('Invalid dock workspace');
  const remaining = [...origin, ...size],
    result = [],
    floating = [];
  const ids = new Set();
  function entry(pane, rect) {
    const header = Math.min(34, rect[3]);
    return [
      pane,
      rect.slice(0, 2),
      rect.slice(2),
      [rect[0], rect[1] + header],
      [rect[2], Math.max(0, rect[3] - header)],
    ];
  }
  for (const pane of panes.filter(Boolean)) {
    if (ids.has(pane.id)) throw new Error(`Duplicate dock pane ${pane.id}`);
    ids.add(pane.id);
    if (pane.visible === false) continue;
    const opts = pane.options ?? {},
      saved = placements?.[pane.id] ?? {};
    let dock = opts.fixed ? 'center' : (saved.dock ?? opts.dock ?? 'left');
    if (dock === 'center') continue;
    if (dock === 'floating') {
      const width = clamp(number(saved.width, 420), 120, size[0]);
      const height = clamp(number(saved.height, 320), 80, size[1]);
      const x = clamp(
        number(saved.x, origin[0] + (size[0] - width) / 2),
        origin[0],
        origin[0] + size[0] - width,
      );
      const y = clamp(
        number(saved.y, origin[1] + (size[1] - height) / 2),
        origin[1],
        origin[1] + size[1] - height,
      );
      floating.push(entry(pane, [x, y, width, height]));
      continue;
    }
    const edge = edges.includes(dock) ? dock : (opts.dock ?? 'left');
    const vertical = edge === 'left' || edge === 'right',
      axis = vertical ? 2 : 3;
    const requested = number(saved.extent, number(opts.extent, 260));
    const extent = clamp(
      requested <= 1 ? remaining[axis] * requested : requested,
      Math.min(120, Math.max(0, remaining[axis] - 120)),
      Math.max(0, remaining[axis] - 120),
    );
    const rect = [...remaining];
    rect[axis] = extent;
    if (edge === 'right') rect[0] += remaining[2] - extent;
    if (edge === 'bottom') rect[1] += remaining[3] - extent;
    result.push(entry(pane, rect));
    if (edge === 'left') remaining[0] += extent;
    if (edge === 'top') remaining[1] += extent;
    remaining[axis] -= extent;
  }
  for (const pane of panes.filter(Boolean)) {
    const saved = placements?.[pane.id] ?? {},
      opts = pane.options ?? {};
    if (pane.visible !== false && (opts.fixed || (saved.dock ?? opts.dock) === 'center'))
      result.push(entry(pane, remaining));
  }
  return [...result, ...floating];
}

export function dockLayout(placements = {}, panes, origin, size, editor) {
  const minimized = panes.filter(
    (pane) => pane && pane.visible !== false && pane.options?.collapsed,
  );
  // Keep saved split leaves and ratios intact; minimizing only changes visibility.
  const widths = minimized.map((pane) =>
    Math.min(size[0], Math.max(160, 136 + String(pane.label ?? pane.id).length * 8)),
  );
  let rows = minimized.length ? 1 : 0,
    used = 0;
  for (const width of widths) {
    if (used && used + width > size[0]) {
      rows++;
      used = 0;
    }
    used += width;
  }
  const barHeight = Math.min(size[1], rows * 34);
  const rowHeight = rows ? barHeight / rows : 0;
  const activeSize = [size[0], Math.max(0, size[1] - barHeight)];
  const activePanes = panes.map((pane) =>
    minimized.includes(pane) ? { ...pane, visible: false } : pane,
  );
  const initial = edgeDockLayout(placements, activePanes, origin, activeSize);
  const floating = initial
    .filter(([pane]) => isFloating(pane, placements))
    .sort((a, b) => number(placements[a[0].id]?.z, 0) - number(placements[b[0].id]?.z, 0));
  let docked = initial.filter(([pane]) => !isFloating(pane, placements)),
    dividers = [];
  const tree = placements._tree
    ? completeTree(placements._tree, panes, placements, size, editor)
    : treeFromEntries(
        edgeDockLayout(
          placements,
          panes.map((pane) =>
            pane ? { ...pane, options: { ...pane.options, collapsed: false } } : pane,
          ),
          origin,
          size,
        ),
        placements,
        origin,
        size,
        editor,
      );
  if (placements._tree || minimized.length) {
    const arranged = arrangeTree(tree, activePanes, placements, origin, activeSize);
    dividers = arranged.dividers;
    docked = arranged.entries.map(([pane, point, bounds]) => {
      const header = Math.min(34, bounds[1]);
      return [
        pane,
        point,
        bounds,
        [point[0], point[1] + header],
        [bounds[0], Math.max(0, bounds[1] - header)],
      ];
    });
  }
  let x = origin[0],
    y = origin[1] + activeSize[1];
  const tabs = minimized.map((pane, i) => {
    const width = widths[i];
    if (x > origin[0] && x + width > origin[0] + size[0]) {
      x = origin[0];
      y += rowHeight;
    }
    const entry = [pane, [x, y], [width, rowHeight], [x, y], [0, 0], true];
    x += width;
    return entry;
  });
  const result = [
    ...docked.map((entry) => [...entry, false]),
    ...tabs,
    ...floating.map((entry) => [...entry, false]),
  ];
  result.tree = tree;
  result.dividers = dividers;
  return result;
}

export class DockInteraction {
  constructor({
    now = () => performance.now(),
    dwellMs = 700,
    tolerance = 8,
    editor = () => null,
  } = {}) {
    this.editor = editor;
    this.workspaces = new Map();
    this.now = now;
    this.dwellMs = dwellMs;
    this.tolerance = tolerance;
  }
  updatePreview(candidate, x, y, now) {
    const next = policy(
      'dock-hover',
      [this.hover ?? null, candidate ?? null, [x, y], now, this.dwellMs, this.tolerance],
      this.editor(),
    );
    this.hover = next.hover;
    this.preview = next.preview;
  }
  tick(now = this.now()) {
    if (this.drag?.started && this.drag.region.dockKind === 'move')
      this.move(this.drag.lastX, this.drag.lastY, now);
  }
  observe(key, placements, panes, origin, size, entries) {
    this.workspaces.set(key, { placements, panes, origin, size, entries, tree: entries.tree });
  }
  ownerAt(key, x, y) {
    const entries = this.workspaces.get(key)?.entries ?? [];
    return entries.findLast(
      ([, p, s]) => x >= p[0] && y >= p[1] && x < p[0] + s[0] && y < p[1] + s[1],
    )?.[0].id;
  }
  visible(region, x, y) {
    return !region.resizeOwners || region.resizeOwners.includes(this.ownerAt(region.dockKey, x, y));
  }
  cursor(region, down = true) {
    const kind = region?.dockKind;
    if (kind === 'move') return down ? 'grabbing' : 'grab';
    if (kind === 'divider') return region.divider.axis === 'x' ? 'ew-resize' : 'ns-resize';
    if (kind === 'resize-left' || kind === 'resize-right') return 'ew-resize';
    if (kind === 'resize-top' || kind === 'resize-bottom') return 'ns-resize';
    return kind === 'resize' ? 'nwse-resize' : '';
  }
  promote(state, region) {
    const key = region?.dockKey,
      id = region?.dockOwner ?? region?.dockPane;
    const placements = state[key];
    if (!placements || placements[id]?.dock !== 'floating') return false;
    const floats = Object.entries(placements).filter(([, entry]) => entry?.dock === 'floating');
    const highest = Math.max(0, ...floats.map(([, entry]) => number(entry.z, 0)));
    const top = this.workspaces.get(key)?.entries.at(-1)?.[0].id;
    if (top === id && placements[id].z === highest) return false;
    state[key] = policy('dock-promote', [placements, id], this.editor());
    return true;
  }
  resizeRegions(key) {
    const model = this.workspaces.get(key);
    if (!model) return [];
    const { entries, placements, origin, size } = model,
      result = [];
    const dockedOwners = entries
      .filter(([pane]) => placements[pane.id]?.dock !== 'floating')
      .map(([pane]) => pane.id);
    function region(id, kind, rect, paneRect, extra = {}) {
      return {
        id: `dock-${kind}-${id}`,
        label: `Resize ${id}`,
        origin: rect.slice(0, 2),
        size: rect.slice(2),
        dockKey: key,
        dockPane: id,
        dockOwner: id,
        dockKind: kind,
        dockRect: paneRect,
        dockWorkspace: [...origin, ...size],
        decorative: true,
        ...extra,
      };
    }
    for (const [pane, p, s, , , minimized] of entries) {
      const opts = pane.options ?? {},
        dock = placements[pane.id]?.dock ?? opts.dock ?? 'left';
      if (opts.fixed || minimized) continue;
      const [x, y] = p,
        [w, h] = s,
        rect = [...p, ...s],
        id = pane.id;
      const handles = {
        left: [x, y, 6, h],
        right: [x + w - 6, y, 6, h],
        top: [x, y, w, 6],
        bottom: [x, y + h - 6, w, 6],
      };
      if (dock === 'floating') {
        for (const edge of opts.collapsed ? ['left', 'right'] : edges)
          result.push(
            region(id, `resize-${edge}`, handles[edge], rect, {
              resizeOwners: [id],
              dockDefault: dock,
            }),
          );
        if (!opts.collapsed)
          result.push(
            region(id, 'resize', [x + w - 12, y + h - 12, 12, 12], rect, {
              resizeOwners: [id],
              dockDefault: dock,
            }),
          );
      } else if (!placements._tree && !opts.collapsed && edges.includes(dock)) {
        const edge = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[dock];
        const handle = [...handles[edge]];
        if (edge === 'right' || edge === 'bottom') handle[edge === 'right' ? 0 : 1] += 3;
        else handle[edge === 'left' ? 0 : 1] -= 3;
        result.push(
          region(id, `resize-${edge}`, handle, rect, {
            resizeOwners: dockedOwners,
            dockDefault: dock,
          }),
        );
      }
    }
    for (const divider of entries.dividers) {
      result.push(
        region(
          `split-${divider.path.join('-') || 'root'}`,
          'divider',
          divider.rect,
          divider.container,
          { divider, resizeOwners: divider.owners },
        ),
      );
    }
    return result;
  }
  begin(state, region, x, y) {
    if (!region?.dockPane) return false;
    const saved = state[region.dockKey] ?? {};
    this.hover = null;
    this.preview = null;
    this.drag = {
      state,
      region,
      x,
      y,
      saved: structuredClone(saved),
      tree: this.workspaces.get(region.dockKey)?.tree,
      started: false,
    };
    return true;
  }
  target(x, y) {
    return this.drag
      ? (policy('dock-workspace-preview', [[x, y], this.drag.region.dockWorkspace], this.editor())
          ?.edge ?? null)
      : null;
  }
  move(x, y, now = this.now()) {
    const drag = this.drag;
    if (!drag || (!drag.started && Math.hypot(x - drag.x, y - drag.y) < 6)) return false;
    drag.started = true;
    drag.lastX = x;
    drag.lastY = y;
    const region = drag.region,
      point = [x, y],
      start = [drag.x, drag.y];
    const before = drag.saved[region.dockPane] ?? { dock: region.dockDefault };
    if (region.dockKind === 'divider') {
      const { axis, container, path, minA, minB } = region.divider,
        index = axis === 'x' ? 0 : 1;
      const total = container[index + 2];
      const ratio = clamp(
        (point[index] - container[index]) / total,
        minA / total,
        1 - minB / total,
      );
      drag.state[region.dockKey] = {
        ...drag.state[region.dockKey],
        _tree: setRatio(drag.tree, path, ratio, this.editor()),
      };
      this.preview = null;
      return true;
    }
    const placements = drag.state[region.dockKey] ?? {};
    const resize = region.dockKind.startsWith('resize');
    const value = policy(
      resize ? 'dock-resize' : 'dock-floating',
      resize ? [before, region, start, point] : [before, region, start, point, placements],
      this.editor(),
    );
    if (resize) this.preview = null;
    else {
      const model = this.workspaces.get(region.dockKey);
      const preview = model
        ? policy(
            'dock-pane-preview',
            [region.dockPane, point, region.dockWorkspace, model.entries, model.placements],
            this.editor(),
          )
        : policy('dock-workspace-preview', [point, region.dockWorkspace], this.editor());
      if (drag.saved._tree)
        drag.state[region.dockKey] = {
          ...placements,
          _tree: removeLeaf(drag.saved._tree, region.dockPane, this.editor()),
        };
      this.updatePreview(preview, x, y, now);
    }
    drag.state[region.dockKey] = { ...drag.state[region.dockKey], [region.dockPane]: value };
    return true;
  }
  end(cancel = false) {
    if (!this.drag) return;
    if (!cancel) this.tick();
    const { state, region, saved, started } = this.drag;
    if (cancel) state[region.dockKey] = saved;
    else if (started && this.preview?.ready) {
      const model = this.workspaces.get(region.dockKey);
      state[region.dockKey] = policy(
        'dock-drop',
        [
          state[region.dockKey],
          model?.tree ?? this.drag.tree ?? null,
          region.dockPane,
          this.preview,
        ],
        this.editor(),
      );
    }
    this.drag = null;
    this.preview = null;
    this.hover = null;
  }
}

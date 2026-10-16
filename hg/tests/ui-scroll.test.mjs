import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AppCore } from '../app.js';
import { Compiler } from '../compiler.js';
import { Data } from '../data.js';

const source = readFileSync(new URL('../ui.lisp', import.meta.url), 'utf8');
const vec2 = (x = 0, y = x) => Data.vector(2, [x, y]);
const rect = (x, y, w, h) => Data.vector(4, [x, y, w, h]);
const values = value => Data.values(value);

async function harness(t, trace) {
  const app = AppCore.new({ trace, fetch: async url => {
    assert.equal(url, 'https://ui.test/editor/theme.lisp');
    return { ok: true, text: async () => readFileSync(new URL('../../editor/theme.lisp', import.meta.url), 'utf8') };
  }, bindings: {
    layer() {}, 'layer-regions'() {}, 'text-proxy'() {}, cursor() {}, clear() {},
  } });
  app.graphics = {};
  app.services.graphics = { createShader: () => () => {},
    createText: () => Data.dict('w', 100, 'h', 20), destroy() {} };
  const module = await AppCore.executeModule(app, AppCore.compileModule(app, source, { sourceURL: 'https://ui.test/hg/ui.lisp' }));
  const call = (name, ...args) => Data.get(module, name)(...args);
  const prop = (key, value) => call('ui-prop', key, value);
  const box = (w, h, ...items) => call('ui-box', call('width', w), call('height', h), ...items);
  const layout = (ui, w = 100, h = 100) => {
    call('ui-measure', ui, ui.root);
    call('ui-arrange', ui, ui.root, rect(0, 0, w, h), rect(0, 0, w, h));
    ui['measure-dirty'] = false;
    ui['layout-dirty'] = false;
  };
  const make = node => {
    const ui = call('ui-new', node);
    ui.mounted = true;
    layout(ui);
    return ui;
  };
  const input = (ui, name, fields = {}) => {
    const event = Data.dict('x', 50, 'y', 50, 'dx', 0, 'dy', 0, 'mode', 0,
      'button', 0, 'id', 1, 'prevent-default', false, ...Object.entries(fields).flat());
    call('ui-input', ui, name, event);
    return event;
  };
  t.after(() => AppCore.destroy(app));
  return { call, prop, box, layout, make, input };
}

test('editor and UI Lisp sources remain syntactically valid', () => {
  for (const file of ['../ui.lisp', '../../editor/main.lisp', '../../editor/theme.lisp',
    '../../editor/project.lisp', '../../editor/vfs.lisp', '../../editor/files.lisp', '../../editor/inspector.lisp', '../../editor/game.lisp', '../../editor/settings.lisp', '../../project/main.lisp'])
    assert.doesNotThrow(() => Compiler.read(readFileSync(new URL(file, import.meta.url), 'utf8')));
});

for (const trace of [true, false]) {
  for (const kind of ['ui-bar', 'ui-menu', 'ui-taskbar']) {
    test(`${kind} scrolls overflowing content with either wheel axis and preserves units (trace=${trace})`, async t => {
      const { call, box, make, layout, input } = await harness(t, trace);
      const items = [box(100, 20), box(100, 20), box(100, 20)];
      const workspace = call('ui-dock');
      const bar = kind === 'ui-taskbar' ? call(kind, workspace, ...items) : call(kind, ...items);
      const ui = make(kind === 'ui-taskbar' ? call('ui-vbox', workspace, bar) : bar);
      const send = fields => input(ui, 'wheel', { x: bar.bounds.x + 50, y: bar.bounds.y + 20, ...fields });
      assert.ok(bar.state['max-scroll'] > 100);
      const origin = items[0].bounds.x;
      const event = send({ dx: -0.5, dy: 30 });
      assert.equal(bar.state.scroll, 30);
      assert.equal(event['prevent-default'], true);
      layout(ui);
      assert.equal(items[0].bounds.x, origin - 30);
      send({ dx: 40, dy: -0.5 });
      assert.equal(bar.state.scroll, 70);
      send({ dx: 0.1, dy: -10 });
      assert.equal(bar.state.scroll, 60);
      send({ dx: 0.5, dy: -1, mode: 1 });
      assert.equal(bar.state.scroll, 40);
      send({ dx: 1, dy: 0.1, mode: 2 });
      assert.equal(bar.state.scroll, 140);
      send({ dx: 0, dy: 0.25 });
      assert.equal(bar.state.scroll, 140.25);
      send({ dy: 10000 });
      assert.equal(bar.state.scroll, bar.state['max-scroll']);
      send({ dx: -10000, dy: 0.1 });
      assert.equal(bar.state.scroll, 0);
    });
  }

  test(`theme dictionaries preserve local configuration, reach new nodes, and remain local to one UI (trace=${trace})`, async t => {
    const { call, layout } = await harness(t, trace);
    const label = call('ui-label', 'Themed');
    const explicit = call('ui-label', 'Local', call('size', 29), call('font', 'serif'));
    const popup = call('ui-dropdown', 'Menu', call('ui-button', 'Action'));
    const button = call('ui-button', 'Button');
    const root = call('ui-vbox', label, explicit, popup, button);
    const ui = call('ui-new', root), other = call('ui-new', call('ui-label', 'Other UI'));
    const color = Data.vector(4, [0.2, 0.3, 0.4, 1]);
    const theme = Data.dict('text', Data.dict('font', 'monospace', 'color', color),
      'components', Data.dict('label', Data.dict('size', 21), 'button', Data.dict('background', color),
        'popup', Data.dict('background', color)));
    assert.equal(call('ui-theme', ui, theme), ui);
    assert.deepEqual([label.props.font, label.props.size, explicit.props.font, explicit.props.size],
      ['monospace', 21, 'serif', 29]);
    assert.equal(button.props.background, color);
    assert.equal(popup.state['popup-node'].props.background, color);
    assert.equal(other.root.props.size, 16);
    const late = call('ui-label', 'Added after applying the theme');
    root.children.push(late);
    layout(ui);
    assert.deepEqual([late.props.font, late.props.size], ['monospace', 21]);
    call('ui-theme', ui, Data.dict());
    assert.deepEqual([label.props.font, label.props.size, late.props.size, explicit.props.size],
      ['sans-serif', 16, 16, 29]);
    assert.notEqual(button.props.background, color);
  });

  test(`component and role theme rules also work for custom components (trace=${trace})`, async t => {
    const { call, prop } = await harness(t, trace);
    const node = call('ui-node', Data.dict('theme-key', 'custom'), Data.dict('padding', 1), prop('theme-key', 'special'));
    const ui = call('ui-new', node);
    const theme = Data.dict('components', Data.dict('custom', Data.dict('padding', 3, 'gap', 4),
      'special', Data.dict('padding', 6)));
    call('ui-theme', ui, theme);
    assert.deepEqual([node.props.padding, node.props.gap], [6, 4]);
    theme.components.special.padding = 8;
    call('ui-theme', ui, theme);
    assert.deepEqual([node.props.padding, node.props.gap], [8, 4]);
  });

  test(`focusing a wide row reveals it vertically without horizontal jumping (trace=${trace})`, async t => {
    const { call, prop, box, make } = await harness(t, trace);
    const row = box(400, 24, prop('focusable', true));
    const node = call('ui-scroll', prop('scroll-x', true), box(400, 200), row);
    const ui = make(node);
    call('ui-scroll-to', ui, node, vec2(35, 0));
    call('ui-focus', ui, call('ui-path', ui.root, row));
    assert.equal(node.state.offset.x, 35);
    assert.ok(node.state.offset.y > 0);
  });

  test(`scroll state survives reconstruction and temporarily empty content (trace=${trace})`, async t => {
    const { call, prop, box, make, layout } = await harness(t, trace);
    const saved = Data.dict('x', 0, 'y', 120);
    const content = box(80, 0);
    const node = call('ui-scroll', prop('scroll-state', saved), content);
    const ui = make(node);
    assert.equal(node.state.offset.y, 0);
    assert.equal(saved.y, 120);
    content.props.h = 600;
    layout(ui);
    assert.equal(node.state.offset.y, 120);
    call('ui-scroll-to', ui, node, vec2(0, 200));
    assert.equal(saved.y, 200);
    const restored = call('ui-scroll', prop('scroll-state', saved), box(80, 600));
    make(restored);
    assert.equal(restored.state.offset.y, 200);
  });

  test(`scroll view preserves fractional wheel deltas, units, and both axes (trace=${trace})`, async t => {
    const { call, prop, box, make, input } = await harness(t, trace);
    const content = box(300, 600);
    const node = call('ui-scroll', prop('scroll-x', true), content);
    const ui = make(node);
    assert.deepEqual(values(node.state.viewport), [0, 0, 92, 92]);
    assert.deepEqual(values(node.state['max-offset']), [208, 508]);
    assert.equal(input(ui, 'wheel', { dy: 0.5 })['prevent-default'], true);
    assert.equal(node.state.offset.y, 0.5);
    assert.equal(content.bounds.y, -0.5);
    input(ui, 'wheel', { dy: 2, mode: 1 });
    assert.equal(node.state.offset.y, 40.5);
    input(ui, 'wheel', { dy: 1, mode: 2 });
    assert.equal(node.state.offset.y, 132.5);
    input(ui, 'wheel', { dy: 10, shift: true });
    input(ui, 'wheel', { dx: 5 });
    assert.equal(node.state.offset.x, 15);
    input(ui, 'wheel', { dx: 10000, dy: 10000 });
    assert.deepEqual(values(node.state.offset), [208, 508]);
    const other = call('ui-scroll', box(100, 200));
    make(other);
    assert.deepEqual(values(other.state.offset), [0, 0]);
  });

  test(`scroll view reclamps offsets on resize, content shrink, and axis changes (trace=${trace})`, async t => {
    const { call, prop, box, make, layout } = await harness(t, trace);
    const content = box(300, 600);
    const node = call('ui-scroll', prop('scroll-x', true), content);
    const ui = make(node);
    call('ui-scroll-to', ui, node, vec2(999));
    layout(ui, 250, 400);
    assert.deepEqual(values(node.state['max-offset']), [58, 208]);
    assert.deepEqual(values(node.state.offset), [58, 208]);
    content.props.w = 10; content.props.h = 20;
    layout(ui);
    assert.deepEqual(values(node.state.offset), [0, 0]);
    assert.deepEqual(values(node.state.viewport), [0, 0, 100, 100]);
    assert.ok(node.overlays.every(overlay => overlay.props.visible === false));
    content.props.h = 100.5;
    layout(ui);
    call('ui-scroll-to', ui, node, vec2(0, 0.5));
    assert.equal(node.state.offset.y, 0.5);
    assert.ok(Math.abs(node.state['thumb-y'].y + node.state['thumb-y'].w -
      node.state['track-y'].y - node.state['track-y'].w) < 0.00001);
    content.props.w = 300; content.props.h = 600;
    node.props['scroll-x'] = false;
    layout(ui);
    assert.equal(node.state['max-offset'].x, 0);
    assert.equal(node.state.viewport.w, 100);
    assert.equal(node.state['max-offset'].y, 500);
  });

  test(`nested scroll views consume wheel input until their edge, then pass it outward (trace=${trace})`, async t => {
    const { call, box, make, input } = await harness(t, trace);
    const inner = call('ui-scroll', call('height', 80), box(80, 200));
    const outer = call('ui-scroll', inner, box(80, 400));
    const ui = make(outer);
    input(ui, 'wheel', { x: 20, y: 20, dy: 30 });
    assert.equal(inner.state.offset.y, 30);
    assert.equal(outer.state.offset.y, 0);
    call('ui-scroll-to', ui, inner, inner.state['max-offset']);
    input(ui, 'wheel', { x: 20, y: 20, dy: 25 });
    assert.equal(inner.state.offset.y, 120);
    assert.equal(outer.state.offset.y, 25);
    call('ui-scroll-to', ui, outer, outer.state['max-offset']);
    const event = input(ui, 'wheel', { x: 20, y: 20, dy: 25 });
    assert.equal(event['prevent-default'], false);
  });

  test(`scrollbars support track clicks, captured dragging, and keyboard navigation (trace=${trace})`, async t => {
    const { call, prop, box, make, input } = await harness(t, trace);
    const node = call('ui-scroll', prop('scroll-x', true), box(300, 600));
    const ui = make(node);
    input(ui, 'pointerdown', { x: 96, y: 70 });
    assert.ok(node.state.offset.y > 0);
    assert.equal(node.state.drag.axis, 'y');
    input(ui, 'pointermove', { x: 150, y: 150 });
    assert.equal(node.state.offset.y, 508);
    input(ui, 'pointerup', { x: 150, y: 150 });
    assert.equal(node.state.drag, null);
    input(ui, 'keydown', { code: 'Home' });
    assert.equal(node.state.offset.y, 0);
    input(ui, 'keydown', { code: 'PageDown' });
    assert.equal(node.state.offset.y, 92);
    input(ui, 'keydown', { code: 'ArrowRight' });
    assert.equal(node.state.offset.x, 20);
    input(ui, 'keydown', { code: 'End', ctrl: true });
    assert.deepEqual(values(node.state.offset), [208, 508]);
    input(ui, 'pointerdown', { x: 50, y: 96 });
    input(ui, 'pointermove', { x: -100, y: 150 });
    input(ui, 'pointerup', { x: -100, y: 150 });
    assert.equal(node.state.offset.x, 0);
  });

  test(`scroll view clips hits and reveals focused children without stealing their keys (trace=${trace})`, async t => {
    const { call, prop, box, make, input } = await harness(t, trace);
    let clicks = 0;
    const button = box(80, 30, prop('focusable', true), call('ui-on', 'click', () => { clicks++; }));
    const node = call('ui-scroll', box(80, 250), button);
    const ui = make(node);
    assert.equal(call('ui-hit', node, 20, 280), null);
    call('ui-focus', ui, call('ui-path', node, button));
    assert.equal(node.state.offset.y, 188);
    assert.ok(button.bounds.y >= node.state.viewport.y);
    assert.ok(button.bounds.y + button.bounds.w <= 100);
    const before = node.state.offset.y;
    input(ui, 'keydown', { code: 'Home' });
    assert.equal(node.state.offset.y, before);
    input(ui, 'pointerdown', { x: 20, y: 90 });
    input(ui, 'pointerup', { x: 20, y: 90 });
    assert.equal(clicks, 1);
  });
}

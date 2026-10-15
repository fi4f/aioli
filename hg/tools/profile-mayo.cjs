// Profile the real editor in isolated Chrome; instrumentation stays in this tool.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
async function main() {
  const server = http.createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, `.${name}`);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.lisp': 'text/plain' };
      response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 800 },
      deviceScaleFactor: Number(process.env.MERCURY_DPR || 1.25),
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/index.js', async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      if (process.env.MERCURY_TRACE !== undefined)
        source = source.replace(
          /const app = hg.App.new\([\s\S]*?\);/,
          `const app = hg.App.new({ trace: ${process.env.MERCURY_TRACE === '1'}, c: canvas });`,
        );
      source = source.replace(
        "app.state['pixel-ratio'] = ratio;",
        "window.profileApp = app;\napp.state['pixel-ratio'] = ratio;",
      );
      await route.fulfill({ response, body: source });
    });
    await page.addInitScript(() => {
      window.profileCosts = {
        frame: [],
        workPerFrame: [],
        graphics: [],
        render: [],
        update: [],
        input: [],
        inputToSubmit: [],
        passes: [],
        gpu: [],
      };
      window.profileWork = 0;
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        request((time) => {
          const start = performance.now();
          callback(time);
          profileCosts.frame.push(performance.now() - start);
          profileCosts.workPerFrame.push(profileWork);
          window.profileWork = 0;
        });
      document.addEventListener(
        'beforeinput',
        (event) => {
          if (event.target.hasAttribute('data-hg-text-proxy'))
            window.profileInput = performance.now();
        },
        true,
      );
    });
    if (process.env.MERCURY_GPU_PROFILE === '1')
      await page.addInitScript(() => {
        const request = GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice = function (descriptor = {}) {
          return request.call(
            this,
            this.features.has('timestamp-query')
              ? {
                  ...descriptor,
                  requiredFeatures: [
                    ...new Set([...(descriptor.requiredFeatures || []), 'timestamp-query']),
                  ],
                }
              : descriptor,
          );
        };
      });
    const base = process.env.AIOLI_URL || `http://127.0.0.1:${server.address().port}`;
    await page.goto(new URL('/index.html', base).href);
    try {
      await page.waitForFunction(
        () =>
          window.profileApp?.scene &&
          document.querySelector('[data-hg-text-proxy]')?.value.length > 0,
      );
    } catch (error) {
      console.error(
        errors,
        await page.evaluate(() => ({
          scene: !!window.profileApp?.scene,
          failed: window.profileApp?.failed,
          proxies: document.querySelectorAll('textarea').length,
        })),
      );
      throw error;
    }
    await page.evaluate(
      async (extraLines) => {
        const { App } = await import('/hg/app.js');
        const app = profileApp;
        // Chrome's emulated DPR does not emulate devicePixelContentBoxSize.
        app.outerCanvas.width = Math.round(innerWidth * devicePixelRatio);
        app.outerCanvas.height = Math.round(innerHeight * devicePixelRatio);
        app.state.editor.auto = false;
        if (extraLines)
          app.state.editor.source += '\n' + '; larger document sample\n'.repeat(extraLines);
        let depth = 0;
        const timed =
          (name, callback) =>
          (...args) => {
            const work = ['graphics', 'update', 'input'].includes(name);
            const outer = work && depth++ === 0;
            const start = performance.now();
            try {
              return callback(...args);
            } finally {
              const cost = performance.now() - start;
              profileCosts[name].push(cost);
              if (work) depth--;
              if (outer) window.profileWork += cost;
            }
          };
        app.services.graphics = {
          ...app.services.graphics,
          render: timed('graphics', app.services.graphics.render),
        };
        app.scene.update = timed('update', app.scene.update);
        app.scene.render = timed('render', app.scene.render);
        app.input.emit = timed('input', app.input.emit);
        for (const proxy of app.textProxies) proxy.callback = timed('input', proxy.callback);
        const device = app.graphics.device;
        const create = device.createCommandEncoder.bind(device);
        let passes = 0;
        let encoderIndex = 0;
        window.profileMaps = new Set();
        device.createCommandEncoder = (...args) => {
          const encoder = create(...args),
            begin = encoder.beginRenderPass.bind(encoder);
          const phase = window.profilePhase;
          const sampled = device.features.has('timestamp-query') && encoderIndex++ % 10 === 0;
          const query = sampled ? device.createQuerySet({ type: 'timestamp', count: 256 }) : null;
          let queries = 0;
          encoder.beginRenderPass = (descriptor) => {
            passes++;
            if (!query) return begin(descriptor);
            const start = queries;
            queries += 2;
            return begin({
              ...descriptor,
              timestampWrites: {
                querySet: query,
                beginningOfPassWriteIndex: start,
                endOfPassWriteIndex: start + 1,
              },
            });
          };
          if (query) {
            const finish = encoder.finish.bind(encoder);
            encoder.finish = (...args) => {
              if (!queries) {
                query.destroy();
                return finish(...args);
              }
              const size = queries * 8;
              const resolved = device.createBuffer({
                size,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
              });
              const read = device.createBuffer({
                size,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
              });
              encoder.resolveQuerySet(query, 0, queries, resolved, 0);
              encoder.copyBufferToBuffer(resolved, 0, read, 0, size);
              const buffer = finish(...args);
              const submit = device.queue.submit.bind(device.queue);
              // Read only after this command buffer has been submitted.
              const queueSubmit = device.queue.submit;
              device.queue.submit = (buffers) => {
                device.queue.submit = queueSubmit;
                const result = submit(buffers);
                const pending = read
                  .mapAsync(GPUMapMode.READ)
                  .then(() => {
                    const times = new BigUint64Array(read.getMappedRange());
                    if (phase === window.profilePhase)
                      profileCosts.gpu.push(Number(times[times.length - 1] - times[0]) / 1e6);
                  })
                  .finally(() => {
                    read.destroy();
                    resolved.destroy();
                    query.destroy();
                    profileMaps.delete(pending);
                  });
                profileMaps.add(pending);
                return result;
              };
              return buffer;
            };
          }
          return encoder;
        };
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = (...args) => {
          const result = submit(...args);
          profileCosts.passes.push(passes);
          passes = 0;
          if (window.profileInput !== undefined) {
            profileCosts.inputToSubmit.push(performance.now() - profileInput);
            window.profileInput = undefined;
          }
          return result;
        };
        window.profileDesktop = App.read(app, App.inspect(app).desktop);
      },
      Number(process.env.MERCURY_EXTRA_LINES || 0),
    );
    await page.waitForTimeout(1500);
    const profiler =
      process.env.MERCURY_CPU_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
    if (profiler) {
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.start');
    }
    const results = {};
    async function phase(name, work) {
      await page.evaluate(async (name) => {
        await Promise.all(profileMaps);
        window.profilePhase = name;
        window.profileWork = 0;
        Object.values(profileCosts).forEach((values) => (values.length = 0));
      }, name);
      await work();
      await page.evaluate(() => Promise.all(profileMaps));
      results[name] = await page.evaluate(() => {
        const summary = (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          return {
            count: values.length,
            mean: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null,
            p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
            p95: sorted[Math.floor(sorted.length * 0.95)] ?? null,
            max: sorted.at(-1) ?? null,
          };
        };
        return Object.fromEntries(
          Object.entries(profileCosts).map(([name, values]) => [name, summary(values)]),
        );
      });
    }
    await phase('idle', () => page.waitForTimeout(1500));
    await phase('hover', async () => {
      for (let i = 0; i < 60; i++) await page.mouse.move(60 + i * 10, 16);
    });
    await page.mouse.click(70, 120);
    if (process.env.MERCURY_START_ROW)
      await page.evaluate(async (row) => {
        const { TextProxy } = await import('/hg/text-proxy.js');
        const proxy = [...profileApp.textProxies][0];
        TextProxy.select(proxy, row, 0);
        TextProxy.focus(proxy);
      }, Number(process.env.MERCURY_START_ROW));
    else await page.keyboard.press('Control+Home');
    await phase('typing', async () => {
      await page.keyboard.type('; typing latency sample abcdefghijklmnopqrstuvwxyz\n', {
        delay: Number(process.env.MERCURY_KEY_DELAY || 35),
      });
      if (process.env.MERCURY_BACKSPACE === '1')
        for (let i = 0; i < 30; i++) await page.keyboard.press('Backspace');
      await page.waitForTimeout(100);
    });
    await phase('drag', async () => {
      await page.mouse.move(80, 53);
      await page.mouse.down();
      for (let i = 0; i < 40; i++) await page.mouse.move(100 + i * 9, 90 + i * 4);
      await page.waitForTimeout(700);
      await page.mouse.up();
    });
    if (process.env.MERCURY_UI_WORKLOAD === '1') {
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        await App.exec(
          profileApp,
          '(ui-focus desktop (ui-path desktop.root workspace.state.panes.0.children.1.children.0))',
        );
      });
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Shift+ArrowRight');
      const caret = () =>
        page.evaluate(() => {
          const proxy = [...profileApp.textProxies][0];
          return {
            anchor: profileApp.state.editor.anchor,
            head: profileApp.state.editor.head,
            scroll: profileApp.state.editor.scroll,
            focused: document.activeElement === proxy.target,
          };
        });
      results.reload = { before: await caret() };
      const reloadStart = Date.now();
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        await App.patchSource(profileApp, profileApp.state.editor.source);
      });
      results.reload.commitMs = Date.now() - reloadStart;
      await page.waitForTimeout(60);
      results.reload.durationMs = Date.now() - reloadStart;
      results.reload.after = await caret();
      results.reload.inputRoutes = await page.evaluate(() => profileApp.__inputRoutes__.size);
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        await App.exec(
          profileApp,
          '(for pane workspace.state.panes (ui-pane-minimize desktop pane))',
        );
      });
      await page.waitForTimeout(60);
      async function tray() {
        return page.evaluate(async () => {
          const { App } = await import('/hg/app.js');
          const ui = App.read(profileApp, App.inspect(profileApp).desktop);
          return ui.root.children[2].children
            .filter((node) => node.props.pane)
            .map((node) => ({ id: node.props.pane.props.id, bounds: node.bounds }));
        });
      }
      results.taskbar = { before: await tray() };
      const first = results.taskbar.before[0].bounds;
      const last = results.taskbar.before.at(-1).bounds;
      await page.mouse.move(first.x + first.z / 2, first.y + first.w / 2);
      await page.mouse.down();
      await page.mouse.move(last.x + last.z - 4, last.y + last.w / 2, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(60);
      results.taskbar.after = await tray();
      const tile = results.taskbar.after.find((item) => item.id === 'Bindings').bounds;
      await page.mouse.move(tile.x + tile.z / 2, tile.y + tile.w / 2);
      await page.mouse.down();
      await page.mouse.move(tile.x + tile.z / 2, tile.y - 100, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(60);
      results.taskbar.undocked = await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        const workspace = App.read(profileApp, App.inspect(profileApp).workspace);
        return workspace.state.panes.map((pane) => ({
          id: pane.props.id,
          minimized: pane.state.minimized,
          floating: pane.state.floating,
          bounds: pane.bounds,
        }));
      });
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        profileApp.state.layout = {};
        await App.patchSource(profileApp, profileApp.source);
      });
      await page.waitForTimeout(60);
      const dockGeometry = () =>
        page.evaluate(async () => {
          const { App } = await import('/hg/app.js');
          const workspace = App.read(profileApp, App.inspect(profileApp).workspace);
          return {
            panes: workspace.state.panes.map((pane) => ({
              id: pane.props.id,
              bounds: pane.bounds,
            })),
            dividers: workspace.state.dividers.map((divider) => ({
              axis: divider.tree.axis,
              bounds: divider.bounds,
            })),
          };
        });
      results.resize = { before: await dockGeometry() };
      const divider = results.resize.before.dividers[0];
      const grip = divider.bounds;
      await page.mouse.move(grip.x + grip.z / 2, grip.y + grip.w / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.z / 2 + 40, grip.y + grip.w / 2, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(60);
      results.resize.after = await dockGeometry();
      await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        await App.exec(
          profileApp,
          '(set workspace.state.panes.0.props.title "A very long source pane title that should scroll across the handle") (ui-invalidate desktop)',
        );
      });
      await page.waitForTimeout(60);
      const title = await page.evaluate(async () => {
        const { App } = await import('/hg/app.js');
        return App.read(profileApp, App.inspect(profileApp).workspace).state.panes[0].state[
          'title-node'
        ].bounds;
      });
      await page.mouse.move(title.x + 40, title.y + title.w / 2);
      await page.waitForTimeout(1000);
      const marquee = () =>
        page.evaluate(async () => {
          const { App } = await import('/hg/app.js');
          return App.read(profileApp, App.inspect(profileApp).workspace).state.panes[0].state[
            'title-node'
          ].state.marquee;
        });
      results.marquee = { hoveredOffset: await marquee() };
      await page.mouse.move(12, 12);
      await page.waitForTimeout(60);
      results.marquee.leftOffset = await marquee();
    }
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame])),
        durations = new Map();
      profile.samples.forEach((id, index) =>
        durations.set(id, (durations.get(id) || 0) + profile.timeDeltas[index]),
      );
      results.hot = [...durations]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([id, time]) => ({ ...nodes.get(id), ms: time / 1000 }));
    }
    results.environment = await page.evaluate(() => ({
      trace: profileApp.trace,
      dpr: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      bitmap: [profileApp.outerCanvas.width, profileApp.outerCanvas.height],
      adapter: ['vendor', 'architecture', 'device', 'description'].map((key) => [
        key,
        profileApp.graphics.adapter.info[key],
      ]),
      timestampQuery: profileApp.graphics.device.features.has('timestamp-query'),
      textures: profileApp.graphics.pools.map((pool) => pool.length),
      stats: profileApp.graphics.stats,
      failed: profileApp.failed || profileApp.inputFailed,
      sourceLength: profileApp.state.editor.source.length,
    }));
    results.errors = errors;
    if (process.env.MERCURY_SCREENSHOT) await page.screenshot({ path: process.env.MERCURY_SCREENSHOT });
    const output = JSON.stringify(results, null, 2);
    if (process.env.MERCURY_OUTPUT) await fs.writeFile(process.env.MERCURY_OUTPUT, output + '\n');
    console.log(output);
    if (errors.length || results.environment.failed) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

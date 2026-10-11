const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/index.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.evaluate(async () => {
      for (const [name, file] of [
        ['Data', 'data'],
        ['Compiler', 'compiler'],
        ['Graphics', 'graphics'],
        ['Input', 'input'],
        ['InnerCanvas', 'inner-canvas'],
        ['Trace', 'trace'],
        ['TextProxy', 'text-proxy'],
      ]) {
        window[name] = (await import(`/hg/${file}.js`))[name];
      }
    });
    await page.evaluate(
      async (extraLines) => {
        const { AppCore } = await import('/hg/app.js');
        const { Scheduler } = await import('/hg/scheduler.js');
        Object.assign(window, { AppCore, Scheduler });
        const source = (await (await fetch('/editor/main.lisp')).text()).replace(
          '(App.tokenize app state.source)',
          '(measure-tokens state.source)',
        );
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
        document.body.append(canvas);
        const costs = {
          input: [],
          proxy: [],
          tokenize: [],
          text: [],
          frame: [],
          render: [],
          inputToSubmit: [],
        };
        let pendingInput;
        const timed =
          (name, fn) =>
          (...args) => {
            const start = performance.now();
            try {
              return fn(...args);
            } finally {
              costs[name].push(performance.now() - start);
            }
          };
        const runtime = AppCore.new();
        runtime.bindings['measure-tokens'] = timed('tokenize', (source) =>
          runtime.bindings.App.tokenize(runtime, source),
        );
        await AppCore.attach(runtime, canvas);
        const proxy = runtime.bindings['text-proxy'];
        runtime.bindings['text-proxy'] = (callback) =>
          proxy((edit) => {
            const callbackTime = performance.now();
            pendingInput ??= callbackTime;
            costs.proxy.push(callbackTime - pendingInput);
            return timed('input', callback)(edit);
          });
        runtime.services.graphics = {
          ...runtime.services.graphics,
          createText: timed('text', runtime.services.graphics.createText),
        };
        const render = runtime.services.graphics.render;
        runtime.services.graphics.render = (...args) => {
          timed('render', render)(...args);
          if (pendingInput !== undefined) {
            costs.inputToSubmit.push(performance.now() - pendingInput);
            pendingInput = undefined;
          }
        };
        const requestFrame = runtime.requestFrame;
        runtime.requestFrame = (callback) => requestFrame((time) => timed('frame', callback)(time));
        Object.assign(runtime.state, {
          source: source + '\n' + '; larger document sample\n'.repeat(extraLines),
          anchor: 0,
          head: 0,
          scroll: 0,
          error: '',
        });
        AppCore.setScene(runtime, source, {
          sourceURL: new URL('/editor/main.lisp', location.href).href,
        });
        document.addEventListener(
          'beforeinput',
          (event) => {
            if (event.target.hasAttribute('data-hg-text-proxy')) pendingInput = performance.now();
          },
          true,
        );
        window.typingProfile = { costs, runtime };
      },
      Number(process.env.MAYO_EXTRA_LINES || 0),
    );
    await page.waitForTimeout(500);
    const profiler = process.env.MAYO_CPU_PROFILE ? await page.context().newCDPSession(page) : null;
    if (profiler) {
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.start');
    }
    await page.evaluate(() =>
      Object.values(typingProfile.costs).forEach((values) => (values.length = 0)),
    );
    const startRow = Number(process.env.MAYO_START_ROW || 0);
    if (startRow) {
      await page.evaluate((row) => {
        // Choose a document-relative position even when the native mirror holds
        // only a bounded context around the caret.
        const proxy = [...typingProfile.runtime.textProxies][0];
        TextProxy.select(proxy, row, 0);
      }, startRow);
    } else await page.keyboard.press('Control+Home');
    await page.keyboard.type('; typing latency sample abcdefghijklmnopqrstuvwxyz\n', {
      delay: Number(process.env.MAYO_KEY_DELAY || 35),
    });
    if (process.env.MAYO_BACKSPACE) {
      for (let i = 0; i < 30; i++) await page.keyboard.press('Backspace');
    }
    await page.waitForTimeout(100);
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
      const durations = new Map();
      profile.samples.forEach((id, index) =>
        durations.set(id, (durations.get(id) || 0) + profile.timeDeltas[index]),
      );
      console.log(
        JSON.stringify(
          [...durations]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([id, time]) => ({
              function: nodes.get(id).callFrame.functionName,
              file: nodes.get(id).callFrame.url,
              line: nodes.get(id).callFrame.lineNumber + 1,
              hotLines: nodes.get(id).positionTicks,
              ms: time / 1000,
            })),
        ),
      );
    }
    console.log(
      JSON.stringify(
        await page.evaluate(() => {
          const summarize = (values) => {
            const sorted = [...values].sort((a, b) => a - b);
            return {
              count: values.length,
              meanMs: values.reduce((sum, n) => sum + n, 0) / values.length,
              p95Ms: sorted[Math.floor(sorted.length * 0.95)],
              maxMs: Math.max(...values),
            };
          };
          return Object.fromEntries(
            Object.entries(typingProfile.costs).map(([name, values]) => [name, summarize(values)]),
          );
        }),
      ),
    );
  } finally {
    await browser.close();
  }
})();

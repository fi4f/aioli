const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.frameCosts = [];
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => request(time => {
        const start = performance.now(); callback(time);
        window.frameCosts.push(performance.now() - start);
      });
    });
    await page.goto(new URL('/editor.html', process.env.AIOLI_URL || 'http://localhost:3000').href);
    await page.waitForFunction(() => document.querySelector('[data-aioli-text-proxy]')?.value.length > 0);
    await page.waitForTimeout(1500);
    console.log(JSON.stringify(await page.evaluate(() => {
      const proxy = document.querySelector('[data-aioli-text-proxy]');
      const costs = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now(); proxy.dispatchEvent(new Event('keyup'));
        costs.push(performance.now() - start);
      }
      const average = values => values.reduce((sum, n) => sum + n, 0) / values.length;
      return { frames: frameCosts.length, frameMeanMs: average(frameCosts), frameMaxMs: Math.max(...frameCosts),
        duplicateInputMeanMs: average(costs), sourceLength: proxy.value.length };
    })));
  } finally { await browser.close(); }
})();

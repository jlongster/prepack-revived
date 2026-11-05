// Serves site/dist and takes screenshots with headless Chromium.
//   NODE_PATH=/path/with/playwright-core node site/scripts/screenshot.js OUTDIR [selector ...]
// Without selectors it captures a series of viewport-sized frames down the page at 1440 and 390 px.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright-core");

const DIST = process.env.DIST ? path.resolve(process.env.DIST) : path.join(__dirname, "..", "dist");
const out = path.resolve(process.argv[2] || "shots");
const selectors = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  fs.readFile(p, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }).end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const scheme = process.env.SCHEME || "light";
  for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    if (selectors.length) {
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({ path: path.join(out, `${name}-${sel.replace(/[^a-z0-9]+/gi, "_")}.png`) });
      }
    } else {
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const frames = Math.min(60, Math.ceil(total / height));
      const step = Math.max(height, Math.floor(total / frames));
      for (let i = 0, y = 0; y < total; i++, y += step) {
        await page.evaluate(yy => window.scrollTo(0, yy), y);
        await page.waitForTimeout(80);
        await page.screenshot({ path: path.join(out, `${name}-${String(i).padStart(2, "0")}.png`) });
      }
      console.log(name, "height", total, "frames", frames);
    }
    await page.close();
  }
  await browser.close();
  server.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});

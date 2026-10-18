/* global console, document, process, setTimeout */
// Captures the showcase screenshots from the production build running in
// headless Chromium. Serve `dist/` first, then run:
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/capture-screenshots.mjs [url]
//
// The live-play shot comes from a real Solo rally: a small bot reads the ball
// and the left paddle off the canvas pixels and holds W or S, exactly as a
// player's keys would.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] ?? "http://localhost:4173/";
const out = (name) => resolve(root, "showcase", name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await sleep(800);

async function tap(key) {
  await page.keyboard.press(key);
  await sleep(80);
}

/** The ball's and the left paddle's centres, read off the canvas pixels. */
function locate() {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let bx = 0;
  let by = 0;
  let bn = 0;
  let py = 0;
  let pn = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 245 && g > 235 && b > 195 && b < 232) {
        bx += x;
        by += y;
        bn++;
      } else if (x >= 48 && x <= 64 && r < 90 && g > 200 && b > 230) {
        py += y;
        pn++;
      }
    }
  }
  return {
    ball: bn ? { x: bx / bn, y: by / bn } : null,
    paddle: pn ? py / pn : null,
  };
}

await page.screenshot({ path: out("title.png") });

await tap("ArrowDown");
await tap("ArrowDown");
await tap("Enter");
await sleep(300);
await page.screenshot({ path: out("howto.png") });
await tap("Escape");

// Start Solo and play until the rally is in full flow, then shoot it.
await tap("ArrowDown");
await tap("Enter");
let held = null;
let shot = false;
const started = Date.now();
while (Date.now() - started < 40000 && !shot) {
  const { ball, paddle } = await page.evaluate(locate);
  let want = null;
  if (ball && paddle !== null) {
    const swing = ball.x < 160 ? 40 : 0;
    if (ball.y + swing < paddle - 12) want = "KeyW";
    else if (ball.y + swing > paddle + 12) want = "KeyS";
  }
  if (want !== held) {
    if (held) await page.keyboard.up(held);
    if (want) await page.keyboard.down(want);
    held = want;
  }
  const elapsed = Date.now() - started;
  if (elapsed > 9000 && ball && ball.x > 380 && ball.x < 900) {
    await page.screenshot({ path: out("rally.png") });
    shot = true;
  }
}
if (held) await page.keyboard.up(held);
console.log(shot ? "captured rally.png" : "no rally shot captured");

await browser.close();

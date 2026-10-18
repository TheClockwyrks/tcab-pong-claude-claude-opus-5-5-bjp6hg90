/* global console, EventTarget */
// Records the showcase replay: a Solo rally played by the game itself, its
// left paddle steered through the debug surface, captured with the engine's
// draw-command recorder and written gzipped to `showcase/rally.json.gz`.
//
//   node scripts/record-replay.mjs
//
// The game runs headless over an `@napi-rs/canvas` canvas on a constant 60 Hz
// clock, exactly as the unit tests run it. Several rallies are played and the
// one that banks off the obstacles most often is kept.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import { runnerImport } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { module: carom } = await runnerImport(resolve(root, "src/game.ts"));
const { module: constants } = await runnerImport(
  resolve(root, "src/constants.ts"),
);
const { FIELD_W, FIELD_H, LAYOUT, CUES, PADDLE_SPEED } = constants;
// The engine's modules use bundler-style specifiers, so it loads through Vite too.
const { module: engineModule } = await runnerImport(
  resolve(root, ".vendor/engine/@clockwyrks/simple-2d/dist/index.js"),
);
const { ConstantClock, createEngine } = engineModule;

const FRAMES = 540; // nine seconds at 60 Hz
const ATTEMPTS = 12;

async function boot() {
  const target = new EventTarget();
  const engine = createEngine({
    canvas: createCanvas(FIELD_W, FIELD_H),
    width: FIELD_W,
    height: FIELD_H,
    game: carom.game,
    background: carom.BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(1000 / 60),
    surface: {
      cssWidth: () => FIELD_W,
      cssHeight: () => FIELD_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  await engine.initialize();
  return engine;
}

/** Steers the left paddle toward the ball, swinging through it to add spin. */
function steer(state, swing) {
  const { ball, paddles } = state;
  const cy = paddles.left.cy;
  if (!ball || ball.held || ball.vx >= 0) {
    return Math.max(-PADDLE_SPEED, Math.min(PADDLE_SPEED, (360 - cy) * 4));
  }
  const eta = (ball.x - 75) / -ball.vx;
  const aim = ball.y + ball.vy * Math.min(eta, 0.4) - swing * 30;
  const vy = (aim - cy) * 6 + (eta < 0.12 ? swing * PADDLE_SPEED : 0);
  return Math.max(-PADDLE_SPEED, Math.min(PADDLE_SPEED, vy));
}

async function attempt(index) {
  const engine = await boot();
  const debug = engine.debug;
  let banks = 0;
  let hits = 0;
  engine.events.on("cue:played", (e) => {
    if (e.cue === CUES.obstacleBounce) banks++;
    if (e.cue === CUES.paddleHit) hits++;
  });

  engine.apply((s) => debug.setPaddleDriven(s, "left", true));
  // Open a Solo point at the serve, then play through the hold.
  engine.apply((s) => debug.setScreen(s, "countdown"));
  engine.apply((s) => debug.setReceiver(s, index % 2 ? "right" : "left"));
  await engine.advance(50);

  engine.startRecording();
  for (let frame = 0; frame < FRAMES; frame++) {
    const swing = Math.sin(frame / 37 + index) > 0 ? 1 : -1;
    engine.apply((s) => debug.setPaddleVy(s, "left", steer(s, swing)));
    await engine.advance(1);
  }
  const recording = engine.stopRecording();
  const score = engine.state.score;
  return { recording, banks, hits, points: score.p1 + score.p2 };
}

let best = null;
for (let i = 0; i < ATTEMPTS; i++) {
  const run = await attempt(i);
  const merit = run.banks * 3 + run.hits - run.points * 2;
  console.log(
    `attempt ${i}: ${run.hits} returns, ${run.banks} banks, ${run.points} points`,
  );
  if (!best || merit > best.merit) best = { ...run, merit };
}

const out = resolve(root, "showcase/rally.json.gz");
mkdirSync(dirname(out), { recursive: true });
const gz = gzipSync(JSON.stringify(best.recording), { level: 9 });
writeFileSync(out, gz);
console.log(
  `kept ${best.hits} returns and ${best.banks} banks: ${(gz.length / 1024).toFixed(0)} KiB`,
);

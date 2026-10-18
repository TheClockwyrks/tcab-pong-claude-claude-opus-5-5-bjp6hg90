// Carom — drawing. Everything is drawn in code, in the field's logical units,
// from the read-only state alone; nothing here changes the state.

import type { DeepReadonly } from "ts-essentials";
import {
  BALL_R,
  FIELD_CX,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  NET_X,
  OBSTACLES,
  P1_X0,
  P2_X0,
  PADDLE_H,
  PADDLE_HALF,
  PADDLE_W,
  SPIN_CLAMP,
  TITLE_TEXT,
} from "./constants";
import type { CaromState, Screen } from "./game";
import { menuItemRect, menuItems } from "./menus";

type Ctx = CanvasRenderingContext2D;
type View = DeepReadonly<CaromState>;

export const COLORS = {
  background: "#0b0f1a",
  grid: "rgba(120, 150, 220, 0.06)",
  border: "rgba(140, 170, 255, 0.22)",
  net: "rgba(170, 190, 255, 0.28)",
  left: "#38e1ff",
  right: "#ff4f9a",
  ball: "#fff6d8",
  obstacle: "#ffb43a",
  text: "#e8ecff",
  dimText: "rgba(200, 210, 255, 0.6)",
  panel: "rgba(8, 11, 22, 0.82)",
  accent: "#c7f36b",
} as const;

const SANS = "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

function font(size: number, weight = 700, family = SANS): string {
  return `${weight} ${size}px ${family}`;
}

function roundedRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function text(
  ctx: Ctx,
  copy: string,
  x: number,
  y: number,
  size: number,
  color: string,
  options: { weight?: number; family?: string; align?: CanvasTextAlign } = {},
): void {
  ctx.font = font(size, options.weight ?? 700, options.family ?? SANS);
  ctx.textAlign = options.align ?? "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(copy, x, y);
}

function glowing(
  ctx: Ctx,
  color: string,
  blur: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

// ---- The field -------------------------------------------------------------

function drawBackdrop(ctx: Ctx): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < FIELD_W; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, FIELD_H);
  }
  for (let y = 40; y < FIELD_H; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(FIELD_W, y);
  }
  ctx.stroke();

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 1.5);
  ctx.lineTo(FIELD_W, 1.5);
  ctx.moveTo(0, FIELD_H - 1.5);
  ctx.lineTo(FIELD_W, FIELD_H - 1.5);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle = COLORS.net;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 16]);
  ctx.beginPath();
  ctx.moveTo(NET_X, 8);
  ctx.lineTo(NET_X, FIELD_H - 8);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = COLORS.net;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(FIELD_CX, FIELD_H / 2, 70, 0, Math.PI * 2);
  ctx.stroke();
}

function drawObstacles(ctx: Ctx, state: View): void {
  for (const obstacle of state.obstacles) {
    const r = OBSTACLES[obstacle.index];
    glowing(ctx, COLORS.obstacle, 18, () => {
      ctx.fillStyle = COLORS.obstacle;
      roundedRect(ctx, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 8);
      ctx.fill();
    });
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    roundedRect(ctx, r.x0 + 4, r.y0 + 6, 4, r.y1 - r.y0 - 12, 2);
    ctx.fill();
  }
}

function drawPaddle(ctx: Ctx, x0: number, cy: number, color: string): void {
  glowing(ctx, color, 22, () => {
    ctx.fillStyle = color;
    roundedRect(ctx, x0, cy - PADDLE_HALF, PADDLE_W, PADDLE_H, 7);
    ctx.fill();
  });
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  roundedRect(ctx, x0 + 4, cy - PADDLE_HALF + 8, 3, PADDLE_H - 16, 1.5);
  ctx.fill();
}

/**
 * The trail is one tapered ribbon through the recorded samples, narrow and
 * transparent at its oldest end and full width at the ball, so it bends
 * wherever the flight bent.
 */
function drawTrail(ctx: Ctx, state: View): void {
  const ball = state.ball;
  if (ball === null) return;
  const points: { x: number; y: number }[] = [];
  for (const sample of ball.trail) {
    const last = points[points.length - 1];
    if (!last || Math.hypot(sample.x - last.x, sample.y - last.y) > 0.5) {
      points.push(sample);
    }
  }
  if (points.length < 2) return;

  const n = points.length;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const w = BALL_R * (0.15 + 0.8 * (i / (n - 1)));
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  });

  const tail = points[0];
  const head = points[n - 1];
  const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  gradient.addColorStop(0, "rgba(255, 236, 190, 0)");
  gradient.addColorStop(1, "rgba(255, 236, 190, 0.6)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left.slice(1)) ctx.lineTo(p.x, p.y);
  for (const p of right.reverse()) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
}

function drawBall(ctx: Ctx, state: View): void {
  const ball = state.ball;
  if (ball === null) return;
  glowing(ctx, COLORS.ball, 20, () => {
    ctx.fillStyle = COLORS.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  });

  // Spin reads as an arc around the ball, its sweep the spin's magnitude and its
  // side the way the flight will curve.
  const amount = Math.min(1, Math.abs(ball.spin) / SPIN_CLAMP);
  if (amount > 0.02) {
    const heading = Math.atan2(ball.vy, ball.vx);
    const towards = heading + (ball.spin > 0 ? Math.PI / 2 : -Math.PI / 2);
    const sweep = amount * Math.PI * 0.9;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(
      ball.x,
      ball.y,
      BALL_R + 6,
      towards - sweep / 2,
      towards + sweep / 2,
    );
    ctx.stroke();
  }
}

function drawServeCue(ctx: Ctx, state: View): void {
  const ball = state.ball;
  if (ball === null || !ball.held) return;
  const fraction = Math.min(1, Math.max(0, ball.holdTimer / HOLD_TIME));
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(
    ball.x,
    ball.y,
    BALL_R + 12,
    -Math.PI / 2,
    -Math.PI / 2 + fraction * Math.PI * 2,
  );
  ctx.stroke();

  // A chevron toward the side the serve will travel.
  const dir = state.receiver === "left" ? -1 : 1;
  const tipX = ball.x + dir * (BALL_R + 46);
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.moveTo(tipX, ball.y);
  ctx.lineTo(tipX - dir * 14, ball.y - 10);
  ctx.lineTo(tipX - dir * 14, ball.y + 10);
  ctx.closePath();
  ctx.fill();
}

function drawField(ctx: Ctx, state: View): void {
  drawBackdrop(ctx);
  drawObstacles(ctx, state);
  drawPaddle(ctx, P1_X0, state.paddles.left.cy, COLORS.left);
  drawPaddle(ctx, P2_X0, state.paddles.right.cy, COLORS.right);
  drawTrail(ctx, state);
  drawBall(ctx, state);
}

// ---- The HUD ---------------------------------------------------------------

export function modeLabel(state: View): string {
  return state.mode === "solo" ? "SOLO  ·  VS CPU" : "VERSUS  ·  2 PLAYERS";
}

function drawHud(ctx: Ctx, state: View): void {
  glowing(ctx, COLORS.left, 16, () =>
    text(ctx, String(state.score.p1), FIELD_CX - 110, 64, 64, COLORS.left, {
      family: MONO,
    }),
  );
  glowing(ctx, COLORS.right, 16, () =>
    text(ctx, String(state.score.p2), FIELD_CX + 110, 64, 64, COLORS.right, {
      family: MONO,
    }),
  );
  text(ctx, modeLabel(state), FIELD_CX, FIELD_H - 26, 16, COLORS.dimText, {
    weight: 600,
  });
  if (state.muted) {
    text(ctx, "MUTED", FIELD_W - 24, FIELD_H - 26, 14, COLORS.dimText, {
      weight: 600,
      align: "right",
    });
  }
}

// ---- Menus and overlays ----------------------------------------------------

function veil(ctx: Ctx, alpha: number): void {
  ctx.fillStyle = `rgba(6, 8, 16, ${alpha})`;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

function drawMenu(ctx: Ctx, screen: Screen, selected: number): void {
  menuItems(screen).forEach((label, index) => {
    const r = menuItemRect(screen, index);
    if (r === null) return;
    const active = index === selected;
    if (active) {
      glowing(ctx, COLORS.accent, 20, () => {
        ctx.fillStyle = COLORS.accent;
        roundedRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.fill();
      });
    } else {
      ctx.fillStyle = "rgba(20, 26, 46, 0.85)";
      roundedRect(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.strokeStyle = "rgba(170, 190, 255, 0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    text(
      ctx,
      label,
      r.x + r.w / 2,
      r.y + r.h / 2 + 1,
      24,
      active ? COLORS.background : COLORS.text,
    );
  });
}

function drawTitle(ctx: Ctx, state: View): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  drawField(ctx, state);
  ctx.restore();
  veil(ctx, 0.35);

  glowing(ctx, COLORS.left, 40, () =>
    text(ctx, TITLE_TEXT, FIELD_CX, 210, 150, COLORS.text, { weight: 900 }),
  );
  text(
    ctx,
    "A PADDLE DUEL OF SPIN AND BANK SHOTS",
    FIELD_CX,
    300,
    20,
    COLORS.obstacle,
    { weight: 600 },
  );
  drawMenu(ctx, "title", state.menuIndex);
  text(
    ctx,
    "W / S or ↑ / ↓ to choose   ·   ENTER to select   ·   M to mute",
    FIELD_CX,
    FIELD_H - 36,
    16,
    COLORS.dimText,
    { weight: 500 },
  );
}

const HOWTO_LINES: readonly (readonly [string, string])[] = [
  ["MOVE", "Player one: W / S.  Player two (Versus): ↑ / ↓."],
  ["", "In Solo, either pair moves your left paddle."],
  [
    "SPIN",
    "Move your paddle as you strike: the ball curves the way you moved.",
  ],
  ["", "Up-swing curves it upward, down-swing downward. Spin fades over time."],
  [
    "ANGLE",
    "Hit near a paddle's end for a steep angle, the centre to drive flat.",
  ],
  ["BANKS", "Two amber posts guard the middle. Bank around them, or off them."],
  ["WIN", "First to 11, by two clear points. Every return speeds the ball up."],
  ["KEYS", "P or ESC pauses  ·  M mutes  ·  ENTER selects"],
];

function drawHowto(ctx: Ctx, state: View): void {
  ctx.save();
  ctx.globalAlpha = 0.25;
  drawField(ctx, state);
  ctx.restore();
  veil(ctx, 0.5);

  ctx.fillStyle = COLORS.panel;
  roundedRect(ctx, 150, 50, FIELD_W - 300, 530, 20);
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  text(ctx, "HOW TO PLAY", FIELD_CX, 105, 44, COLORS.text, { weight: 900 });
  HOWTO_LINES.forEach(([label, line], i) => {
    const y = 175 + i * 50;
    if (label) {
      text(ctx, label, 300, y, 20, COLORS.accent, { align: "right" });
    }
    text(ctx, line, 330, y, 21, COLORS.text, { weight: 500, align: "left" });
  });
  drawMenu(ctx, "howto", 0);
}

function drawCountdown(ctx: Ctx, state: View): void {
  drawServeCue(ctx, state);
  const ball = state.ball;
  if (ball !== null && ball.held) {
    text(ctx, "GET READY", FIELD_CX, 150, 30, COLORS.text, { weight: 800 });
  }
}

function drawPaused(ctx: Ctx, state: View): void {
  veil(ctx, 0.6);
  text(ctx, "PAUSED", FIELD_CX, 220, 72, COLORS.text, { weight: 900 });
  drawMenu(ctx, "paused", state.menuIndex);
}

export function winnerHeadline(state: View): string {
  if (state.winner === null) return "MATCH OVER";
  if (state.mode === "solo") {
    return state.winner === "left" ? "YOU WIN" : "CPU WINS";
  }
  return state.winner === "left" ? "PLAYER ONE WINS" : "PLAYER TWO WINS";
}

function drawMatchover(ctx: Ctx, state: View): void {
  veil(ctx, 0.65);
  const color =
    state.winner === "right"
      ? COLORS.right
      : state.winner === "left"
        ? COLORS.left
        : COLORS.text;
  glowing(ctx, color, 30, () =>
    text(ctx, winnerHeadline(state), FIELD_CX, 220, 76, color, { weight: 900 }),
  );
  text(
    ctx,
    `${state.score.p1}  –  ${state.score.p2}`,
    FIELD_CX,
    330,
    56,
    COLORS.text,
    { family: MONO },
  );
  drawMenu(ctx, "matchover", state.menuIndex);
}

/** Draws the whole frame for the state given. */
export function renderGame(ctx: Ctx, state: View): void {
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      return;
    case "howto":
      drawHowto(ctx, state);
      return;
    default:
      break;
  }

  drawField(ctx, state);
  drawHud(ctx, state);
  if (state.screen === "countdown") drawCountdown(ctx, state);
  else if (state.screen === "paused") drawPaused(ctx, state);
  else if (state.screen === "matchover") drawMatchover(ctx, state);
}

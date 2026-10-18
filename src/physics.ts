// Carom — the render-free physics: paddle integration, the AI's rule, and the
// ball's sub-stepped flight with its collisions (specs/balls.md,
// specs/playfield.md, specs/modes/single-player.md).
//
// Every function here is pure: it takes values and returns new ones, so the
// simulation reads nothing from the renderer, the clock, or the engine.

import type { DeepReadonly } from "ts-essentials";
import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  MAX_SUBSTEP,
  OBSTACLES,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
} from "./constants";
import type { Rect } from "./constants";
import type { AiState, BallState, ObstacleState, Side } from "./game";

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

// ---- Paddles ---------------------------------------------------------------

/** A paddle's vertical position and its integrated velocity for the frame. */
export interface PaddleMotion {
  readonly cy: number;
  readonly vy: number;
}

/**
 * Integrates a paddle at velocity `vy` for `dt` seconds and clamps it to the
 * field. When the clamp bites, `vy` becomes the velocity actually achieved, so a
 * paddle pinned against a bound carries `vy = 0`.
 */
export function integratePaddle(
  cy: number,
  vy: number,
  dt: number,
): PaddleMotion {
  const next = clamp(cy + vy * dt, PADDLE_MIN_CY, PADDLE_MAX_CY);
  const actual = next !== cy + vy * dt && dt > 0 ? (next - cy) / dt : vy;
  return { cy: next, vy: actual };
}

/** The ball as the AI senses it: where it is and how it is moving. */
export interface AiView {
  readonly playing: boolean;
  readonly ball: DeepReadonly<BallState> | null;
}

/** The velocity the AI's rule picks for its paddle this frame. */
export function aiVelocity(
  ai: DeepReadonly<AiState>,
  cy: number,
  view: AiView,
  dt: number,
): number {
  if (!ai.movement) return 0;

  let target = AI_HOME_Y;
  let deadzone = AI_HOME_DEADZONE;
  if (ai.tracking && view.playing && view.ball !== null && view.ball.vx > 0) {
    target = view.ball.y - view.ball.vy * AI_REACT;
    deadzone = AI_DEADZONE;
  }

  const diff = target - cy;
  if (Math.abs(diff) <= deadzone) return 0;
  return Math.sign(diff) * Math.min(AI_SPEED, Math.abs(diff) / dt);
}

// ---- Ball collisions -------------------------------------------------------

export type Face = "left" | "right" | "top" | "bottom";

/** A ball's kinematic state while it flies. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
}

/**
 * The face of `rect` a ball centered at `(x, y)` strikes, or `null` when the
 * ball does not overlap it. Ties go to the first of left, right, top, bottom.
 */
export function struckFace(x: number, y: number, rect: Rect): Face | null {
  const left = x - (rect.x0 - BALL_R);
  const right = rect.x1 + BALL_R - x;
  const top = y - (rect.y0 - BALL_R);
  const bottom = rect.y1 + BALL_R - y;
  if (left <= 0 || right <= 0 || top <= 0 || bottom <= 0) return null;

  let face: Face = "left";
  let depth = left;
  if (right < depth) [face, depth] = ["right", right];
  if (top < depth) [face, depth] = ["top", top];
  if (bottom < depth) face = "bottom";
  return face;
}

/** Places the ball `BALL_R` off `face` and reverses the velocity into it. */
export function bounceOffFace(body: Body, rect: Rect, face: Face): void {
  switch (face) {
    case "left":
      body.x = rect.x0 - BALL_R;
      if (body.vx > 0) body.vx = -body.vx;
      break;
    case "right":
      body.x = rect.x1 + BALL_R;
      if (body.vx < 0) body.vx = -body.vx;
      break;
    case "top":
      body.y = rect.y0 - BALL_R;
      if (body.vy > 0) body.vy = -body.vy;
      break;
    case "bottom":
      body.y = rect.y1 + BALL_R;
      if (body.vy < 0) body.vy = -body.vy;
      break;
  }
}

export function paddleRect(side: Side, cy: number): Rect {
  return side === "left"
    ? { x0: P1_X0, x1: P1_X1, y0: cy - PADDLE_HALF, y1: cy + PADDLE_HALF }
    : { x0: P2_X0, x1: P2_X1, y0: cy - PADDLE_HALF, y1: cy + PADDLE_HALF };
}

/** The paddle bounce: angle from the contact point, speed-up, and spin. */
export function paddleBounce(
  body: Body,
  side: Side,
  paddleCy: number,
  paddleVy: number,
): void {
  const offset = clamp((body.y - paddleCy) / PADDLE_HALF, -1, 1);
  const theta = offset * MAX_BOUNCE_ANGLE;
  const speed = Math.min(Math.hypot(body.vx, body.vy) * SPEED_MULT, SPEED_CAP);
  const dir = side === "left" ? 1 : -1;
  body.vx = dir * speed * Math.cos(theta);
  body.vy = speed * Math.sin(theta);
  body.spin = clamp(
    body.spin + paddleVy * SPIN_FROM_PADDLE,
    -SPIN_CLAMP,
    SPIN_CLAMP,
  );
  body.x = side === "left" ? P1_X1 + BALL_R : P2_X0 - BALL_R;
}

// ---- Ball flight -----------------------------------------------------------

/** The events a frame of flight raised, each at most once. */
export interface FlightEvents {
  paddleHit: boolean;
  wallBounce: boolean;
  obstacleBounce: boolean;
}

export interface FlightResult {
  readonly body: Body;
  readonly events: FlightEvents;
}

/** The paddles as the ball sees them for one frame. */
export interface PaddlesView {
  readonly left: PaddleMotion;
  readonly right: PaddleMotion;
}

/** The number of sub-steps a frame of `dt` seconds at `speed` is cut into. */
export function substepCount(speed: number, dt: number): number {
  return Math.max(1, Math.ceil((speed * dt) / MAX_SUBSTEP));
}

function resolvePaddle(
  body: Body,
  side: Side,
  paddle: PaddleMotion,
  events: FlightEvents,
): void {
  const rect = paddleRect(side, paddle.cy);
  const face = struckFace(body.x, body.y, rect);
  if (face === null) return;
  if (face === "left" || face === "right") {
    paddleBounce(body, side, paddle.cy, paddle.vy);
    events.paddleHit = true;
  } else {
    bounceOffFace(body, rect, face);
    events.wallBounce = true;
  }
}

function resolveWalls(body: Body, events: FlightEvents): void {
  if (body.y - BALL_R < 0 && body.vy < 0) {
    body.y = BALL_R;
    body.vy = -body.vy;
    events.wallBounce = true;
  } else if (body.y + BALL_R > FIELD_H && body.vy > 0) {
    body.y = FIELD_H - BALL_R;
    body.vy = -body.vy;
    events.wallBounce = true;
  }
}

/**
 * Advances a flying ball by `dt` seconds in sub-steps of at most `MAX_SUBSTEP`
 * units of travel, resolving the walls, the paddles, and the obstacles present
 * on every sub-step.
 */
export function advanceBall(
  start: Body,
  paddles: PaddlesView,
  obstacles: DeepReadonly<ObstacleState[]>,
  dt: number,
): FlightResult {
  const body: Body = { ...start };
  const events: FlightEvents = {
    paddleHit: false,
    wallBounce: false,
    obstacleBounce: false,
  };
  // Obstacles resolve in the order of OBSTACLE_CENTERS: A, then B.
  const rects = [...obstacles]
    .sort((a, b) => a.index - b.index)
    .map((o) => OBSTACLES[o.index]);

  const n = substepCount(Math.hypot(body.vx, body.vy), dt);
  const h = dt / n;
  const decay = Math.pow(0.5, h / SPIN_HALFLIFE);

  for (let i = 0; i < n; i++) {
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > 0) {
      const angle = (body.spin / speed) * h;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const vx = body.vx * cos - body.vy * sin;
      body.vy = body.vx * sin + body.vy * cos;
      body.vx = vx;
    }
    body.spin *= decay;
    body.x += body.vx * h;
    body.y += body.vy * h;

    resolveWalls(body, events);
    resolvePaddle(body, "left", paddles.left, events);
    resolvePaddle(body, "right", paddles.right, events);
    for (const rect of rects) {
      const face = struckFace(body.x, body.y, rect);
      if (face !== null) {
        bounceOffFace(body, rect, face);
        events.obstacleBounce = true;
      }
    }
  }

  return { body, events };
}

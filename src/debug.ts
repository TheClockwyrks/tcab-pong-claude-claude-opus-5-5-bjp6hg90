// Carom — the debug and automation surface (specs/instrumentation.md).
//
// Every operation takes the current state first. A pose returns the next state,
// built from the one it was handed; a reading returns what it read. The surface
// holds nothing of its own, so it is inert until something calls it.

import type { DeepReadonly } from "ts-essentials";
import { CAROM_DEBUG_VERSION, OBSTACLE_CENTERS } from "./constants";
import type {
  BallState,
  CaromState,
  Mode,
  PaddleState,
  Screen,
  Side,
} from "./game";
import { menuItemRect } from "./menus";
import type { MenuRect } from "./menus";
import {
  allObstacles,
  drawServeSign,
  initialState,
  obstacleAt,
  parkedBall,
} from "./sim";

type View = DeepReadonly<CaromState>;

export type MenuItemRect = MenuRect;

export interface PaddleSnapshot {
  cy: number;
  vy: number;
  drivenVy: number;
  driven: boolean;
}

export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  spin: number;
  held: boolean;
  holdTimer: number;
  serveSign: 1 | -1;
  trail: { x: number; y: number; t: number }[];
}

/** The whole declared state, as `snapshot` reports it. */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  menuIndex: number;
  titleIndex: number;
  resumeScreen: "countdown" | "playing";
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  paddles: { left: PaddleSnapshot; right: PaddleSnapshot };
  ai: { tracking: boolean; movement: boolean };
  receiver: Side;
  ball: BallSnapshot | null;
  obstacles: { index: number; cx: number; cy: number }[];
  simTime: number;
}

export interface CaromDebugApi {
  readonly version: number;

  // The world
  clearWorld(state: View): CaromState;
  spawnBall(state: View): CaromState;
  spawnObstacle(state: View, index: number): CaromState;
  reset(state: View): CaromState;
  reconcile(state: View): CaromState;

  // Screens and menus
  setScreen(state: View, screen: Screen): CaromState;
  setMode(state: View, mode: Mode): CaromState;
  setMenuIndex(state: View, index: number): CaromState;
  setTitleIndex(state: View, index: number): CaromState;
  setResumeScreen(state: View, screen: "countdown" | "playing"): CaromState;

  // Match state
  setScore(state: View, p1: number, p2: number): CaromState;
  setWinner(state: View, side: Side | null): CaromState;
  setReceiver(state: View, side: Side): CaromState;

  // Paddles
  setPaddleCy(state: View, side: Side, cy: number): CaromState;
  setPaddleVy(state: View, side: Side, vy: number): CaromState;
  setPaddleDriven(state: View, side: Side, driven: boolean): CaromState;

  // The ball
  setBallPosition(state: View, x: number, y: number): CaromState;
  setBallVelocity(state: View, vx: number, vy: number): CaromState;
  setBallSpin(state: View, spin: number): CaromState;
  setBallHeld(state: View, held: boolean): CaromState;
  setBallHoldTimer(state: View, seconds: number): CaromState;
  setBallServeSign(state: View, sign: 1 | -1): CaromState;
  drawBallServeSign(state: View): CaromState;

  // The AI opponent
  setAiTracking(state: View, enabled: boolean): CaromState;
  setAiMovement(state: View, enabled: boolean): CaromState;

  // Audio
  setMuted(state: View, muted: boolean): CaromState;

  // Readings
  snapshot(state: View): CaromSnapshot;
  menuItemRect(state: View, index: number): MenuItemRect | null;
}

const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "matchover",
];

function fail(message: string): never {
  throw new Error(`Carom debug: ${message}`);
}

function number(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${name} must be a finite number, got ${String(value)}`);
  }
  return value;
}

function flag(name: string, value: boolean): boolean {
  if (typeof value !== "boolean") {
    fail(`${name} must be a boolean, got ${String(value)}`);
  }
  return value;
}

function oneOf<T extends string>(
  name: string,
  value: T,
  options: readonly T[],
): T {
  if (!options.includes(value)) {
    fail(`${name} must be one of ${options.join(", ")}, got ${String(value)}`);
  }
  return value;
}

function side(value: Side): Side {
  return oneOf("side", value, ["left", "right"]);
}

function obstacleIndex(index: number): number {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= OBSTACLE_CENTERS.length
  ) {
    fail(`no obstacle has index ${String(index)}`);
  }
  return index;
}

/** The ball posed by `change`, refused loudly while the field carries none. */
function withBall(
  state: View,
  operation: string,
  change: (ball: DeepReadonly<BallState>) => Partial<BallState>,
): CaromState {
  if (state.ball === null) fail(`${operation}: the field carries no ball`);
  return { ...state, ball: { ...state.ball, ...change(state.ball) } };
}

function withPaddle(
  state: View,
  which: Side,
  change: Partial<PaddleState>,
): CaromState {
  const key = side(which);
  return {
    ...state,
    paddles: { ...state.paddles, [key]: { ...state.paddles[key], ...change } },
  };
}

export function snapshot(state: View): CaromSnapshot {
  const paddle = (p: DeepReadonly<PaddleState>): PaddleSnapshot => ({
    cy: p.cy,
    vy: p.vy,
    drivenVy: p.drivenVy,
    driven: p.driven,
  });
  const ball = state.ball;
  return {
    version: CAROM_DEBUG_VERSION,
    screen: state.screen,
    mode: state.mode,
    menuIndex: state.menuIndex,
    titleIndex: state.titleIndex,
    resumeScreen: state.resumeScreen,
    score: { p1: state.score.p1, p2: state.score.p2 },
    winner: state.winner,
    muted: state.muted,
    paddles: {
      left: paddle(state.paddles.left),
      right: paddle(state.paddles.right),
    },
    ai: { tracking: state.ai.tracking, movement: state.ai.movement },
    receiver: state.receiver,
    ball:
      ball === null
        ? null
        : {
            x: ball.x,
            y: ball.y,
            vx: ball.vx,
            vy: ball.vy,
            speed: Math.hypot(ball.vx, ball.vy),
            spin: ball.spin,
            held: ball.held,
            holdTimer: ball.holdTimer,
            serveSign: ball.serveSign,
            trail: ball.trail.map((s) => ({ x: s.x, y: s.y, t: s.t })),
          },
    obstacles: state.obstacles.map((o) => ({
      index: o.index,
      cx: o.cx,
      cy: o.cy,
    })),
    simTime: state.simTime,
  };
}

export function createDebugApi(): CaromDebugApi {
  return {
    version: CAROM_DEBUG_VERSION,

    clearWorld: (state) => ({ ...state, ball: null, obstacles: [] }),
    spawnBall: (state) => ({ ...state, ball: parkedBall() }),
    spawnObstacle: (state, index) => {
      const placed = obstacleAt(obstacleIndex(index));
      const obstacles = [
        ...state.obstacles.filter((o) => o.index !== placed.index),
        placed,
      ].sort((a, b) => a.index - b.index);
      return { ...state, obstacles };
    },
    reset: (state) => ({
      ...initialState(state.muted),
      ball: parkedBall(),
      obstacles: allObstacles(),
    }),
    // Every reading (the ball's speed included) is worked out at the read, so
    // there is no stored copy to bring up to date.
    reconcile: (state) => ({ ...state }),

    setScreen: (state, screen) => ({
      ...state,
      screen: oneOf("screen", screen, SCREENS),
    }),
    setMode: (state, mode) => ({
      ...state,
      mode: oneOf("mode", mode, ["solo", "versus"]),
    }),
    setMenuIndex: (state, index) => ({
      ...state,
      menuIndex: number("menu index", index),
    }),
    setTitleIndex: (state, index) => ({
      ...state,
      titleIndex: number("title index", index),
    }),
    setResumeScreen: (state, screen) => ({
      ...state,
      resumeScreen: oneOf("resume screen", screen, ["countdown", "playing"]),
    }),

    setScore: (state, p1, p2) => ({
      ...state,
      score: { p1: number("p1", p1), p2: number("p2", p2) },
    }),
    setWinner: (state, winner) => ({
      ...state,
      winner: winner === null ? null : side(winner),
    }),
    setReceiver: (state, receiver) => ({ ...state, receiver: side(receiver) }),

    setPaddleCy: (state, which, cy) =>
      withPaddle(state, which, { cy: number("cy", cy) }),
    setPaddleVy: (state, which, vy) =>
      withPaddle(state, which, { drivenVy: number("vy", vy) }),
    setPaddleDriven: (state, which, driven) =>
      withPaddle(state, which, { driven: flag("driven", driven) }),

    setBallPosition: (state, x, y) =>
      withBall(state, "setBallPosition", () => ({
        x: number("x", x),
        y: number("y", y),
      })),
    setBallVelocity: (state, vx, vy) =>
      withBall(state, "setBallVelocity", () => ({
        vx: number("vx", vx),
        vy: number("vy", vy),
      })),
    setBallSpin: (state, spin) =>
      withBall(state, "setBallSpin", () => ({ spin: number("spin", spin) })),
    setBallHeld: (state, held) =>
      withBall(state, "setBallHeld", () => ({ held: flag("held", held) })),
    setBallHoldTimer: (state, seconds) =>
      withBall(state, "setBallHoldTimer", () => ({
        holdTimer: number("seconds", seconds),
      })),
    setBallServeSign: (state, sign) =>
      withBall(state, "setBallServeSign", () => {
        if (sign !== 1 && sign !== -1) {
          fail(`serve sign must be 1 or -1, got ${String(sign)}`);
        }
        return { serveSign: sign };
      }),
    drawBallServeSign: (state) =>
      withBall(state, "drawBallServeSign", () => ({
        serveSign: drawServeSign(),
      })),

    setAiTracking: (state, enabled) => ({
      ...state,
      ai: { ...state.ai, tracking: flag("tracking", enabled) },
    }),
    setAiMovement: (state, enabled) => ({
      ...state,
      ai: { ...state.ai, movement: flag("movement", enabled) },
    }),

    // The frame that follows carries the bit to the runtime (see `update`).
    setMuted: (state, muted) => ({ ...state, muted: flag("muted", muted) }),

    snapshot,
    menuItemRect: (state, index) => menuItemRect(state.screen, index),
  };
}

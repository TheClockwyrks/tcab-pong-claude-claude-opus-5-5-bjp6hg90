// Carom — the frame transition: menus, match flow, serving, and scoring
// (specs/ui.md, specs/balls.md). `stepGame` is the whole of `update` apart from
// the engine calls, so it runs in a test with no engine at all.

import type { DeepReadonly } from "ts-essentials";
import {
  BALL_R,
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  OBSTACLE_CENTERS,
  PADDLE_SPEED,
  SERVE_ANGLE,
  SERVE_SPEED,
  TRAIL_TIME,
  WIN_LEAD,
  WIN_SCORE,
} from "./constants";
import type { CueName } from "./constants";
import type {
  BallState,
  CaromState,
  MenuPress,
  Mode,
  ObstacleState,
  PaddleState,
  Side,
} from "./game";
import type { FrameInput, HeldMovement, PointerEvent } from "./input";
import { isMenuScreen, menuItemAt, menuItems, wrapIndex } from "./menus";
import { advanceBall, aiVelocity, integratePaddle } from "./physics";

// ---- Building blocks of the state -----------------------------------------

/** A fresh serve sign, `1` and `-1` equally likely. */
export function drawServeSign(): 1 | -1 {
  return Math.random() < 0.5 ? 1 : -1;
}

/** The ball parked at its home point, waiting out a full hold. */
export function parkedBall(): BallState {
  return {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: 0,
    vy: 0,
    spin: 0,
    held: true,
    holdTimer: HOLD_TIME,
    serveSign: drawServeSign(),
    trail: [],
  };
}

export function obstacleAt(index: number): ObstacleState {
  const center = OBSTACLE_CENTERS[index];
  return { index, cx: center.x, cy: center.y };
}

export function allObstacles(): ObstacleState[] {
  return OBSTACLE_CENTERS.map((_, index) => obstacleAt(index));
}

const RESTING_PADDLE: PaddleState = {
  cy: FIELD_CY,
  vy: 0,
  driven: false,
  drivenVy: 0,
};

/** The state the game opens on: the title screen. */
export function initialState(muted: boolean): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    titleIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: { left: RESTING_PADDLE, right: RESTING_PADDLE },
    ai: { tracking: true, movement: true },
    receiver: "left",
    ball: parkedBall(),
    obstacles: allObstacles(),
    simTime: 0,
    muted,
    menuPresses: [],
  };
}

/** Starts a match in `mode`, as every menu that starts one does. */
export function startMatch(
  state: DeepReadonly<CaromState>,
  mode: Mode,
): CaromState {
  return {
    ...state,
    mode,
    screen: "countdown",
    resumeScreen: "playing",
    menuIndex: 0,
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    ball: parkedBall(),
    paddles: {
      left: { ...state.paddles.left, cy: FIELD_CY, vy: 0 },
      right: { ...state.paddles.right, cy: FIELD_CY, vy: 0 },
    },
  };
}

/** Returns to the title, keeping the remembered selection, the clock, and mute. */
export function returnToTitle(state: DeepReadonly<CaromState>): CaromState {
  return {
    ...initialState(state.muted),
    titleIndex: state.titleIndex,
    menuIndex: state.titleIndex,
    simTime: state.simTime,
  };
}

// ---- Menus -----------------------------------------------------------------

/** Confirms item `index` of the menu `state.screen` shows. */
export function confirmItem(
  state: DeepReadonly<CaromState>,
  index: number,
): CaromState {
  switch (state.screen) {
    case "title": {
      if (index < 0 || index >= menuItems("title").length) return state;
      const remembered = { ...state, titleIndex: index };
      if (index === 0) return startMatch(remembered, "solo");
      if (index === 1) return startMatch(remembered, "versus");
      return { ...remembered, screen: "howto", menuIndex: 0 };
    }
    case "howto":
      return index === 0 ? returnToTitle(state) : state;
    case "paused":
      if (index === 0) return { ...state, screen: state.resumeScreen };
      if (index === 1) return startMatch(state, state.mode);
      if (index === 2) return returnToTitle(state);
      return state;
    case "matchover":
      if (index === 0) return startMatch(state, state.mode);
      if (index === 1) return returnToTitle(state);
      return state;
    default:
      return state;
  }
}

/** Applies a frame's pointer and touch samples to the menu on screen. */
function applyPointer(
  state: DeepReadonly<CaromState>,
  samples: readonly PointerEvent[],
  mayConfirm: boolean,
): CaromState {
  const screen = state.screen;
  let next: CaromState = state;
  for (const sample of samples) {
    const item = menuItemAt(screen, sample.x, sample.y);
    const others = next.menuPresses.filter((p) => p.id !== sample.id);
    if (sample.type === "down") {
      const presses: MenuPress[] =
        item === null ? others : [...others, { id: sample.id, screen, item }];
      next = {
        ...next,
        menuIndex: item ?? next.menuIndex,
        menuPresses: presses,
      };
    } else if (sample.type === "move") {
      if (item !== null) next = { ...next, menuIndex: item };
    } else {
      const press = next.menuPresses.find((p) => p.id === sample.id);
      next = { ...next, menuPresses: others };
      if (mayConfirm && press?.screen === screen && press.item === item) {
        return confirmItem({ ...next, menuIndex: item }, item);
      }
    }
  }
  return next;
}

/** Applies a frame's input to the menu screen the frame began on. */
function applyMenuInput(
  state: DeepReadonly<CaromState>,
  input: FrameInput,
): CaromState {
  const screen = state.screen;
  if (screen === "paused" && (input.pause || input.back)) {
    return { ...state, screen: state.resumeScreen };
  }
  if ((screen === "howto" || screen === "matchover") && input.back) {
    return returnToTitle(state);
  }

  let next: CaromState = state;
  const count = menuItems(screen).length;
  const moved = input.up || input.down;
  if (screen !== "howto" && moved) {
    next = {
      ...next,
      menuIndex: wrapIndex(next.menuIndex, input.up ? -1 : 1, count),
    };
  }
  if (input.confirm && !moved) return confirmItem(next, next.menuIndex);
  // A keyboard confirm on the frame, even one movement overrode, leaves the
  // pointer nothing to confirm.
  return applyPointer(next, input.pointer, !input.confirm);
}

// ---- The match -------------------------------------------------------------

function humanVelocity(up: number, down: number): number {
  return (down - up) * PADDLE_SPEED;
}

function movedPaddle(
  paddle: DeepReadonly<PaddleState>,
  vy: number,
  dt: number,
): PaddleState {
  const motion = integratePaddle(
    paddle.cy,
    paddle.driven ? paddle.drivenVy : vy,
    dt,
  );
  return { ...paddle, cy: motion.cy, vy: motion.vy };
}

/** Both paddles, moved for one countdown or playing frame. */
export function movePaddles(
  state: DeepReadonly<CaromState>,
  held: HeldMovement,
  dt: number,
): CaromState["paddles"] {
  const { left, right } = state.paddles;
  const solo = state.mode === "solo";
  const leftVy = solo
    ? humanVelocity(
        Math.max(held.p1Up, held.p2Up),
        Math.max(held.p1Down, held.p2Down),
      )
    : humanVelocity(held.p1Up, held.p1Down);
  const rightVy = solo
    ? aiVelocity(
        state.ai,
        right.cy,
        { playing: state.screen === "playing", ball: state.ball },
        dt,
      )
    : humanVelocity(held.p2Up, held.p2Down);
  return {
    left: movedPaddle(left, leftVy, dt),
    right: movedPaddle(right, rightVy, dt),
  };
}

/** The serve: the ball leaves toward `receiver` at the serve angle. */
export function servedBall(
  ball: DeepReadonly<BallState>,
  receiver: Side,
): BallState {
  const dir = receiver === "left" ? -1 : 1;
  return {
    ...ball,
    holdTimer: 0,
    held: false,
    trail: [],
    vx: dir * SERVE_SPEED * Math.cos(SERVE_ANGLE),
    vy: ball.serveSign * SERVE_SPEED * Math.sin(SERVE_ANGLE),
  };
}

/** Whether the score ends the match, and for whom. */
export function matchWinner(p1: number, p2: number): Side | null {
  if (p1 >= WIN_SCORE && p1 - p2 >= WIN_LEAD) return "left";
  if (p2 >= WIN_SCORE && p2 - p1 >= WIN_LEAD) return "right";
  return null;
}

export interface StepResult {
  readonly state: CaromState;
  readonly cues: readonly CueName[];
}

/** One countdown or playing frame: paddles, the ball, its trail, scoring. */
function advanceMatch(
  state: DeepReadonly<CaromState>,
  held: HeldMovement,
  dt: number,
): StepResult {
  const paddles = movePaddles(state, held, dt);
  let next: CaromState = { ...state, paddles };
  const ball = state.ball;
  if (ball === null) return { state: next, cues: [] };

  const cues: CueName[] = [];
  let moved: BallState;
  if (ball.held) {
    const holdTimer = ball.holdTimer - dt;
    if (holdTimer <= 0) {
      moved = servedBall(ball, state.receiver);
      next = { ...next, screen: "playing" };
    } else {
      moved = { ...ball, holdTimer };
    }
  } else {
    const { body, events } = advanceBall(ball, paddles, state.obstacles, dt);
    if (events.wallBounce) cues.push(CUES.wallBounce);
    if (events.paddleHit) cues.push(CUES.paddleHit);
    if (events.obstacleBounce) cues.push(CUES.obstacleBounce);
    moved = { ...ball, ...body };
  }

  const t = state.simTime;
  const trail = [...moved.trail, { x: moved.x, y: moved.y, t }].filter(
    (sample) => t - sample.t <= TRAIL_TIME,
  );
  next = { ...next, ball: { ...moved, trail } };

  if (moved.held) return { state: next, cues };
  const scorer: Side | null =
    moved.x - BALL_R > FIELD_W ? "left" : moved.x + BALL_R < 0 ? "right" : null;
  if (scorer === null) return { state: next, cues };

  cues.push(CUES.score);
  const score =
    scorer === "left"
      ? { p1: state.score.p1 + 1, p2: state.score.p2 }
      : { p1: state.score.p1, p2: state.score.p2 + 1 };
  const winner = matchWinner(score.p1, score.p2);
  if (winner !== null) {
    return {
      state: { ...next, score, winner, screen: "matchover", menuIndex: 0 },
      cues,
    };
  }
  return {
    state: {
      ...next,
      score,
      ball: parkedBall(),
      receiver: scorer === "left" ? "right" : "left",
      screen: "countdown",
    },
    cues,
  };
}

/**
 * The next state from the current one: input first, then whatever the screen
 * the input left the game on advances.
 */
export function stepGame(
  state: DeepReadonly<CaromState>,
  input: FrameInput,
  dt: number,
): StepResult {
  let next: CaromState = { ...state, simTime: state.simTime + dt };

  if (isMenuScreen(next.screen)) {
    next = applyMenuInput(next, input);
  } else if (input.pause) {
    next = {
      ...next,
      resumeScreen: next.screen,
      screen: "paused",
      menuIndex: 0,
    };
  }

  let cues: readonly CueName[] = [];
  if (next.screen === "countdown" || next.screen === "playing") {
    ({ state: next, cues } = advanceMatch(next, input.held, dt));
  }

  const screen = next.screen;
  if (next.menuPresses.some((p) => p.screen !== screen)) {
    next = {
      ...next,
      menuPresses: next.menuPresses.filter((p) => p.screen === screen),
    };
  }
  return { state: next, cues };
}

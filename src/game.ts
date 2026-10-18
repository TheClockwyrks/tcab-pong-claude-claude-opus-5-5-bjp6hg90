// Carom — the game: the state it holds, the debug surface that poses and reads
// that state, and the three functions the engine drives.
//
// The simulation lives in `sim.ts` and `physics.ts`, the menus in `menus.ts`,
// the drawing in `render.ts`, and the debug surface in `debug.ts`. This module
// declares the state contract and wires the pieces to the engine.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { ACTIONS, BINDINGS, CUES } from "./constants";
import type { CueName } from "./constants";
import { createDebugApi } from "./debug";
import type { CaromDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { readFrameInput } from "./input";
import { renderGame } from "./render";
import { initialState, stepGame } from "./sim";

export type { CaromDebugApi, CaromSnapshot, MenuItemRect } from "./debug";

// ---- The state contract (specs/state.md) ----------------------------------

export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

export type Mode = "solo" | "versus";

export type Side = "left" | "right";

export interface PaddleState {
  readonly cy: number;
  readonly vy: number;
  readonly driven: boolean;
  readonly drivenVy: number;
}

export interface AiState {
  readonly tracking: boolean;
  readonly movement: boolean;
}

export interface TrailSample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

export interface BallState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly spin: number;
  readonly held: boolean;
  readonly holdTimer: number;
  readonly serveSign: 1 | -1;
  readonly trail: readonly TrailSample[];
}

export interface ObstacleState {
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
}

export interface CaromState {
  readonly screen: Screen;
  readonly mode: Mode;
  readonly menuIndex: number;
  readonly titleIndex: number;
  readonly resumeScreen: "countdown" | "playing";

  readonly score: { readonly p1: number; readonly p2: number };
  readonly winner: Side | null;

  readonly paddles: { readonly left: PaddleState; readonly right: PaddleState };
  readonly ai: AiState;

  readonly receiver: Side;
  readonly ball: BallState | null;
  readonly obstacles: readonly ObstacleState[];

  readonly simTime: number;
  readonly muted: boolean;

  /**
   * Build-specific, beyond the declaration `specs/state.md` fixes: the menu
   * presses and touch landings still waiting for their release, each with the
   * item it landed on. A pointer confirms an item only when both edges fall in
   * its region, and the two edges may arrive on different frames, so the press
   * is carried here until its release. It starts empty, and returning to the
   * title or a `reset` empties it.
   */
  readonly menuPresses: readonly MenuPress[];
}

/** A pointer or touch contact pressed on a menu item and not yet released. */
export interface MenuPress {
  readonly id: number;
  readonly screen: Screen;
  readonly item: number;
}

// ---- Presentation ----------------------------------------------------------

/** The field background; the letterbox bars are cleared to it as well. */
export const BACKGROUND = "#0b0f1a";

/** Each cue is a short blip of its own, so the four events read apart by ear. */
const CUE_SPECS: Readonly<
  Record<CueName, Parameters<InitApi<CaromState>["audio"]["define"]>[1]>
> = {
  [CUES.paddleHit]: {
    wave: "square",
    freq: 520,
    freqTo: 780,
    gain: 0.14,
    durationMs: 70,
  },
  [CUES.wallBounce]: {
    wave: "triangle",
    freq: 330,
    freqTo: 260,
    gain: 0.2,
    durationMs: 55,
  },
  [CUES.obstacleBounce]: {
    wave: "sine",
    freq: 900,
    freqTo: 1300,
    gain: 0.22,
    durationMs: 90,
  },
  [CUES.score]: {
    wave: "sawtooth",
    freq: 660,
    freqTo: 220,
    gain: 0.12,
    durationMs: 260,
  },
};

// ---- The game --------------------------------------------------------------

export const game: Game<CaromState, CaromDebugApi> = {
  initialize(api: InitApi<CaromState>): [CaromState, CaromDebugApi] {
    for (const name of ACTIONS) {
      api.input.register(name, { keys: [...BINDINGS[name]] });
    }
    for (const [cue, spec] of Object.entries(CUE_SPECS)) {
      api.audio.define(cue, spec);
    }
    registerDiagnostics(api.diagnostics);

    // The runtime's bus starts unmuted, and nothing but this game mutes it.
    return [initialState(false), createDebugApi()];
  },

  update(
    state: DeepReadonly<CaromState>,
    api: UpdateApi,
    dt: number,
  ): CaromState {
    // A `setMuted` pose changes the state's copy of the bit between frames; the
    // frame carries it to the runtime before the `mute` action is read.
    if (state.muted !== api.audio.muted()) api.audio.setMuted(state.muted);

    const input = readFrameInput(state.screen, api.input);
    if (input.toggleMute) api.audio.setMuted(!api.audio.muted());

    const { state: next, cues } = stepGame(state, input, dt);
    for (const cue of cues) api.audio.play(cue);

    return { ...next, muted: api.audio.muted() };
  },

  render(state: DeepReadonly<CaromState>, api: RenderApi): void {
    renderGame(api.ctx, state);
  },
};

// Carom — one frame's input, read once at the top of `update` (specs/ui.md).
//
// Each screen reads only the edges it acts on, so an edge another screen would
// have read is left to the engine to discard when the frame closes.

import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { Screen } from "./game";

/** One pointer sample, in logical units. */
export interface PointerEvent {
  readonly type: "down" | "move" | "up";
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** The movement actions held this frame, each `1` while held. */
export interface HeldMovement {
  readonly p1Up: number;
  readonly p1Down: number;
  readonly p2Up: number;
  readonly p2Down: number;
}

export interface FrameInput {
  readonly held: HeldMovement;
  /** A press edge of `p1-up` or `p2-up`. */
  readonly up: boolean;
  /** A press edge of `p1-down` or `p2-down`. */
  readonly down: boolean;
  readonly confirm: boolean;
  readonly back: boolean;
  readonly pause: boolean;
  readonly toggleMute: boolean;
  readonly pointer: readonly PointerEvent[];
}

export const NO_MOVEMENT: HeldMovement = {
  p1Up: 0,
  p1Down: 0,
  p2Up: 0,
  p2Down: 0,
};

/** A frame that carries no input at all. */
export const NO_INPUT: FrameInput = {
  held: NO_MOVEMENT,
  up: false,
  down: false,
  confirm: false,
  back: false,
  pause: false,
  toggleMute: false,
  pointer: [],
};

type InputApi = UpdateApi["input"];

function either(input: InputApi, a: string, b: string): boolean {
  const first = input.pressed(a);
  const second = input.pressed(b);
  return first || second;
}

/** Reads this frame's input as the screen the frame begins on reads it. */
export function readFrameInput(screen: Screen, input: InputApi): FrameInput {
  const held: HeldMovement = {
    p1Up: input.value("p1-up") > 0 ? 1 : 0,
    p1Down: input.value("p1-down") > 0 ? 1 : 0,
    p2Up: input.value("p2-up") > 0 ? 1 : 0,
    p2Down: input.value("p2-down") > 0 ? 1 : 0,
  };
  const toggleMute = input.pressed("mute");

  if (screen === "countdown" || screen === "playing") {
    return { ...NO_INPUT, held, toggleMute, pause: input.pressed("pause") };
  }

  const pause = screen === "paused" && input.pressed("pause");
  const menu = screen !== "howto";
  return {
    held,
    up: menu && either(input, "p1-up", "p2-up"),
    down: menu && either(input, "p1-down", "p2-down"),
    confirm: input.pressed("confirm"),
    back: input.pressed("back"),
    pause,
    toggleMute,
    pointer: input.pointerSamples().map((s) => ({
      type: s.type,
      id: s.id,
      x: s.x,
      y: s.y,
    })),
  };
}

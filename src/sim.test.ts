import { describe, expect, it } from "vitest";
import {
  CUES,
  FIELD_CX,
  FIELD_CY,
  FIELD_W,
  HOLD_TIME,
  SERVE_ANGLE,
  SERVE_SPEED,
  TRAIL_TIME,
} from "./constants";
import type { CaromState } from "./game";
import { NO_INPUT, NO_MOVEMENT } from "./input";
import type { FrameInput, PointerEvent } from "./input";
import { menuItemAt, menuItemRect, menuItems, wrapIndex } from "./menus";
import {
  initialState,
  matchWinner,
  returnToTitle,
  startMatch,
  stepGame,
} from "./sim";

const DT = 1 / 60;

function step(
  state: CaromState,
  input: Partial<FrameInput> = {},
  dt = DT,
): CaromState {
  return stepGame(state, { ...NO_INPUT, ...input }, dt).state;
}

function center(screen: CaromState["screen"], index: number) {
  const r = menuItemRect(screen, index);
  if (r === null) throw new Error("no such item");
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function sample(
  type: PointerEvent["type"],
  screen: CaromState["screen"],
  index: number,
  id = 1,
): PointerEvent {
  return { type, id, ...center(screen, index) };
}

const OUTSIDE: PointerEvent = { type: "up", id: 1, x: 5, y: 5 };

function playing(partial: Partial<CaromState> = {}): CaromState {
  const match = startMatch(initialState(false), "versus");
  return { ...match, screen: "playing", ...partial };
}

describe("menus", () => {
  it("lays out a region per item and none off the menus", () => {
    expect(menuItems("title")).toHaveLength(3);
    expect(menuItems("howto")).toHaveLength(1);
    expect(menuItems("playing")).toHaveLength(0);
    expect(menuItemRect("countdown", 0)).toBeNull();
    expect(menuItemRect("title", 3)).toBeNull();
    expect(menuItemRect("title", 0.5)).toBeNull();
    const { x, y } = center("paused", 2);
    expect(menuItemAt("paused", x, y)).toBe(2);
    expect(menuItemAt("paused", 0, 0)).toBeNull();
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
  });
});

describe("the title menu", () => {
  const title = initialState(false);

  it("wraps up and down, applying up before down", () => {
    expect(step(title, { up: true }).menuIndex).toBe(2);
    expect(step({ ...title, menuIndex: 2 }, { down: true }).menuIndex).toBe(0);
    expect(step(title, { up: true, down: true }).menuIndex).toBe(2);
  });

  it("moves rather than confirms when both arrive together", () => {
    const next = step(title, { down: true, confirm: true });
    expect(next.screen).toBe("title");
    expect(next.menuIndex).toBe(1);
  });

  it("starts a match, remembering the selection", () => {
    const solo = step(title, { confirm: true }, 0);
    expect(solo).toMatchObject({
      screen: "countdown",
      mode: "solo",
      titleIndex: 0,
      menuIndex: 0,
      resumeScreen: "playing",
      receiver: "left",
      winner: null,
    });
    expect(solo.ball).toMatchObject({ held: true, holdTimer: HOLD_TIME });

    const versus = step({ ...title, menuIndex: 1 }, { confirm: true });
    expect(versus.mode).toBe("versus");
    expect(versus.titleIndex).toBe(1);
  });

  it("opens how to play, and its item returns with the selection kept", () => {
    const howto = step({ ...title, menuIndex: 2 }, { confirm: true });
    expect(howto).toMatchObject({
      screen: "howto",
      menuIndex: 0,
      titleIndex: 2,
    });
    expect(step(howto, { back: true })).toMatchObject({
      screen: "title",
      menuIndex: 2,
    });
    expect(step(howto, { confirm: true }).screen).toBe("title");
    expect(step(howto, { up: true }).screen).toBe("howto");
  });

  it("ignores back and an item index that names nothing", () => {
    expect(step(title, { back: true })).toMatchObject({ screen: "title" });
    expect(step({ ...title, menuIndex: 7 }, { confirm: true }).screen).toBe(
      "title",
    );
  });
});

describe("pointer and touch on the menus", () => {
  const title = initialState(false);

  it("selects the item a pointer moves onto", () => {
    const next = step(title, { pointer: [sample("move", "title", 2)] });
    expect(next.menuIndex).toBe(2);
    expect(step(title, { pointer: [OUTSIDE] }).menuIndex).toBe(0);
  });

  it("confirms a press and release inside one item on one frame", () => {
    const next = step(title, {
      pointer: [sample("down", "title", 1), sample("up", "title", 1)],
    });
    expect(next).toMatchObject({
      screen: "countdown",
      mode: "versus",
      titleIndex: 1,
    });
  });

  it("confirms a press and release that arrive on different frames", () => {
    const pressed = step(title, { pointer: [sample("down", "title", 2)] });
    expect(pressed).toMatchObject({ screen: "title", menuIndex: 2 });
    const released = step(pressed, { pointer: [sample("up", "title", 2)] });
    expect(released.screen).toBe("howto");
    expect(released.menuPresses).toEqual([]);
  });

  it("confirms nothing when the edges fall in different regions", () => {
    const dragged = step(title, {
      pointer: [
        sample("down", "title", 0),
        sample("move", "title", 1),
        sample("up", "title", 1),
      ],
    });
    expect(dragged).toMatchObject({ screen: "title", menuIndex: 1 });
    const outside = step(title, {
      pointer: [{ ...OUTSIDE, type: "down" }, sample("up", "title", 0)],
    });
    expect(outside.screen).toBe("title");
    const releasedOff = step(title, {
      pointer: [sample("down", "title", 0), OUTSIDE],
    });
    expect(releasedOff.screen).toBe("title");
  });

  it("lets a pointer selection override keyboard movement", () => {
    const next = step(title, {
      down: true,
      pointer: [sample("move", "title", 2)],
    });
    expect(next.menuIndex).toBe(2);
  });

  it("keeps the pointer's selection when movement overrides a confirm", () => {
    const next = step(title, {
      down: true,
      confirm: true,
      pointer: [sample("down", "title", 2), sample("up", "title", 2)],
    });
    expect(next).toMatchObject({ screen: "title", menuIndex: 2 });
  });

  it("lets a keyboard confirm win over a pointer confirm", () => {
    const next = step(title, {
      confirm: true,
      pointer: [sample("down", "title", 1), sample("up", "title", 1)],
    });
    expect(next.mode).toBe("solo");
  });

  it("drops a press left over from another screen", () => {
    const pressed = step(title, { pointer: [sample("down", "title", 0)] });
    const elsewhere = step(pressed, { confirm: true });
    expect(elsewhere.screen).toBe("countdown");
    expect(elsewhere.menuPresses).toEqual([]);
  });
});

describe("pause", () => {
  it("opens from playing and countdown, then resumes to that screen", () => {
    const paused = step(playing(), { pause: true });
    expect(paused).toMatchObject({
      screen: "paused",
      resumeScreen: "playing",
      menuIndex: 0,
    });
    expect(step(paused, { pause: true, back: true }).screen).toBe("playing");
    expect(step(paused, { back: true, down: true })).toMatchObject({
      screen: "playing",
      menuIndex: 0,
    });

    const fromCountdown = step(startMatch(initialState(false), "solo"), {
      pause: true,
    });
    expect(fromCountdown.resumeScreen).toBe("countdown");
  });

  it("freezes the field while paused but keeps the clock", () => {
    const paused = step(playing({ ball: { ...playing().ball!, vx: 400 } }), {
      pause: true,
    });
    const later = step(paused, { held: { ...NO_MOVEMENT, p1Down: 1 } }, 0.5);
    expect(later.ball).toEqual(paused.ball);
    expect(later.paddles).toEqual(paused.paddles);
    expect(later.simTime).toBeCloseTo(paused.simTime + 0.5);
  });

  it("offers resume, restart, and quit", () => {
    const paused = step(playing({ score: { p1: 4, p2: 2 }, titleIndex: 1 }), {
      pause: true,
    });
    expect(step(paused, { confirm: true }).screen).toBe("playing");
    const restarted = step({ ...paused, menuIndex: 1 }, { confirm: true }, 0);
    expect(restarted).toMatchObject({
      screen: "countdown",
      mode: "versus",
      score: { p1: 0, p2: 0 },
    });
    const quit = step({ ...paused, menuIndex: 2 }, { confirm: true });
    expect(quit).toMatchObject({
      screen: "title",
      menuIndex: 1,
      titleIndex: 1,
    });
    expect(step({ ...paused, menuIndex: 0 }, { up: true }).menuIndex).toBe(2);
  });
});

describe("the countdown and the serve", () => {
  it("counts the hold down and serves toward the receiver", () => {
    const match = startMatch(initialState(false), "versus");
    const waiting = step(match, {}, 0.5);
    expect(waiting.screen).toBe("countdown");
    expect(waiting.ball!.holdTimer).toBeCloseTo(0.5);
    expect(waiting.ball!.trail.length).toBe(1);

    const sign = waiting.ball!.serveSign;
    const served = step(waiting, {}, 0.5);
    expect(served.screen).toBe("playing");
    expect(served.ball).toMatchObject({
      held: false,
      holdTimer: 0,
      x: FIELD_CX,
      y: FIELD_CY,
    });
    expect(served.ball!.vx).toBeCloseTo(-SERVE_SPEED * Math.cos(SERVE_ANGLE));
    expect(served.ball!.vy).toBeCloseTo(
      sign * SERVE_SPEED * Math.sin(SERVE_ANGLE),
    );
    expect(served.ball!.serveSign).toBe(sign);
    expect(served.ball!.trail).toHaveLength(1);
  });

  it("moves the paddles during the countdown", () => {
    const match = startMatch(initialState(false), "versus");
    const next = step(match, {
      held: { ...NO_MOVEMENT, p1Up: 1, p2Down: 1 },
    });
    expect(next.paddles.left.vy).toBe(-720);
    expect(next.paddles.right.vy).toBe(720);
  });

  it("serves toward the right receiver, and waits with no ball", () => {
    const match = {
      ...startMatch(initialState(false), "solo"),
      receiver: "right" as const,
    };
    const served = step(match, {}, HOLD_TIME);
    expect(served.ball!.vx).toBeGreaterThan(0);
    const empty = step({ ...match, ball: null }, {}, 5);
    expect(empty.screen).toBe("countdown");
  });
});

describe("the paddles in play", () => {
  it("lets either pair move the human paddle in Solo", () => {
    const solo = playing({ mode: "solo" });
    const next = step(solo, { held: { ...NO_MOVEMENT, p2Up: 1 } });
    expect(next.paddles.left.vy).toBe(-720);
  });

  it("moves a driven paddle at its driven velocity alone", () => {
    const base = playing();
    const driven = {
      ...base,
      paddles: {
        ...base.paddles,
        left: { ...base.paddles.left, driven: true, drivenVy: 300 },
      },
    };
    const next = step(driven, { held: { ...NO_MOVEMENT, p1Up: 1 } }, 0.1);
    expect(next.paddles.left.vy).toBe(300);
    expect(next.paddles.left.cy).toBeCloseTo(FIELD_CY + 30);
  });
});

describe("the trail", () => {
  it("keeps only the last TRAIL_TIME seconds of samples", () => {
    let state = playing();
    state = { ...state, ball: { ...state.ball!, held: false, vx: 300 } };
    for (let i = 0; i < 30; i++) state = step(state);
    const trail = state.ball!.trail;
    const newest = trail[trail.length - 1];
    expect(newest.x).toBeCloseTo(state.ball!.x);
    expect(newest.t).toBeCloseTo(state.simTime);
    expect(newest.t - trail[0].t).toBeLessThanOrEqual(TRAIL_TIME + 1e-9);
    expect(trail.length).toBeGreaterThan(5);
  });
});

describe("scoring", () => {
  function scoringFrame(score: { p1: number; p2: number }, x: number) {
    const base = playing({ score });
    return stepGame(
      {
        ...base,
        ball: { ...base.ball!, held: false, x, vx: x > 640 ? 600 : -600 },
      },
      NO_INPUT,
      DT,
    );
  }

  it("scores for player one past the right edge and re-serves", () => {
    const { state, cues } = scoringFrame({ p1: 0, p2: 0 }, FIELD_W + 20);
    expect(state.score).toEqual({ p1: 1, p2: 0 });
    expect(state).toMatchObject({ screen: "countdown", receiver: "right" });
    expect(state.ball).toMatchObject({ held: true, x: FIELD_CX, trail: [] });
    expect(cues).toContain(CUES.score);
  });

  it("scores for player two past the left edge", () => {
    const { state } = scoringFrame({ p1: 0, p2: 0 }, -20);
    expect(state.score).toEqual({ p1: 0, p2: 1 });
    expect(state.receiver).toBe("left");
  });

  it("ends the match at eleven with a two-point lead", () => {
    const { state } = scoringFrame({ p1: 10, p2: 3 }, FIELD_W + 20);
    expect(state).toMatchObject({
      screen: "matchover",
      winner: "left",
      menuIndex: 0,
    });
    const deuce = scoringFrame({ p1: 10, p2: 10 }, -20).state;
    expect(deuce.screen).toBe("countdown");
    expect(matchWinner(11, 10)).toBeNull();
    expect(matchWinner(12, 10)).toBe("left");
    expect(matchWinner(9, 11)).toBe("right");
  });

  it("offers play again and menu once the match is over", () => {
    const over = scoringFrame({ p1: 3, p2: 10 }, -20).state;
    expect(over.winner).toBe("right");
    const again = step(over, { confirm: true }, 0);
    expect(again).toMatchObject({
      screen: "countdown",
      winner: null,
      mode: "versus",
    });
    expect(step({ ...over, menuIndex: 1 }, { confirm: true }).screen).toBe(
      "title",
    );
    expect(step(over, { back: true }).screen).toBe("title");
    expect(step(over, { down: true }).menuIndex).toBe(1);
  });

  it("plays each event's cue once however many sub-steps raised it", () => {
    const base = playing();
    const { cues } = stepGame(
      {
        ...base,
        ball: { ...base.ball!, held: false, x: 640, y: 15, vx: 0, vy: -900 },
      },
      NO_INPUT,
      0.1,
    );
    expect(cues.filter((c) => c === CUES.wallBounce)).toHaveLength(1);
  });
});

describe("returning to the title", () => {
  it("restores the title state, keeping selection, clock, and mute", () => {
    const state = {
      ...playing({ titleIndex: 1, simTime: 12, muted: true, obstacles: [] }),
      score: { p1: 3, p2: 4 },
    };
    const title = returnToTitle(state);
    expect(title).toMatchObject({
      screen: "title",
      menuIndex: 1,
      titleIndex: 1,
      simTime: 12,
      muted: true,
      score: { p1: 0, p2: 0 },
      mode: "solo",
    });
    expect(title.obstacles).toHaveLength(2);
  });
});

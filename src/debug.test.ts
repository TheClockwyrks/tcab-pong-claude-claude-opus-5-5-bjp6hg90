import { describe, expect, it } from "vitest";
import {
  CAROM_DEBUG_VERSION,
  FIELD_CX,
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
} from "./constants";
import { createDebugApi, snapshot } from "./debug";
import type { CaromState } from "./game";
import { initialState } from "./sim";

const debug = createDebugApi();
const fresh = (): CaromState => initialState(false);

describe("the world", () => {
  it("clears the ball and obstacles and spawns them back", () => {
    const empty = debug.clearWorld(fresh());
    expect(snapshot(empty)).toMatchObject({ ball: null, obstacles: [] });

    const withB = debug.spawnObstacle(empty, 1);
    const both = debug.spawnObstacle(withB, 0);
    expect(snapshot(both).obstacles).toEqual([
      { index: 0, cx: OBSTACLE_CENTERS[0].x, cy: OBSTACLE_CENTERS[0].y },
      { index: 1, cx: OBSTACLE_CENTERS[1].x, cy: OBSTACLE_CENTERS[1].y },
    ]);
    expect(debug.spawnObstacle(both, 0).obstacles).toHaveLength(2);

    const ball = debug.spawnBall(empty).ball;
    expect(ball).toMatchObject({
      x: FIELD_CX,
      y: FIELD_CY,
      held: true,
      holdTimer: HOLD_TIME,
      vx: 0,
      vy: 0,
      spin: 0,
      trail: [],
    });
  });

  it("fails loudly on an obstacle index that names nothing", () => {
    expect(() => debug.spawnObstacle(fresh(), 2)).toThrow(/obstacle/);
    expect(() => debug.spawnObstacle(fresh(), -1)).toThrow();
  });

  it("resets every declared field but the mute bit", () => {
    const state = {
      ...debug.setScore(debug.setScreen(fresh(), "playing"), 4, 5),
      muted: true,
      simTime: 9,
    };
    const driven = debug.setPaddleDriven(debug.clearWorld(state), "left", true);
    const reset = debug.reset(driven);
    const expected = snapshot(initialState(true));
    expect({
      ...snapshot(reset),
      ball: { ...snapshot(reset).ball, serveSign: 1 },
    }).toEqual({ ...expected, ball: { ...expected.ball, serveSign: 1 } });
    expect(reset.muted).toBe(true);
  });

  it("reconciles to an equal state without changing anything", () => {
    const state = debug.setBallVelocity(fresh(), 30, 40);
    const once = debug.reconcile(state);
    expect(once).toEqual(state);
    expect(once).not.toBe(state);
    expect(debug.reconcile(once)).toEqual(state);
    expect(snapshot(once).ball!.speed).toBe(50);
  });
});

describe("single-field poses", () => {
  it("sets screens and menus", () => {
    let s = debug.setScreen(fresh(), "matchover");
    s = debug.setMode(s, "versus");
    s = debug.setMenuIndex(s, 1);
    s = debug.setTitleIndex(s, 2);
    s = debug.setResumeScreen(s, "countdown");
    expect(snapshot(s)).toMatchObject({
      screen: "matchover",
      mode: "versus",
      menuIndex: 1,
      titleIndex: 2,
      resumeScreen: "countdown",
    });
    expect(() => debug.setScreen(s, "lobby" as "title")).toThrow();
    expect(() => debug.setMode(s, "duo" as "solo")).toThrow();
    expect(() => debug.setMenuIndex(s, Number.NaN)).toThrow();
  });

  it("sets the match state", () => {
    let s = debug.setScore(fresh(), 7, 9);
    s = debug.setWinner(s, "right");
    s = debug.setReceiver(s, "right");
    expect(snapshot(s)).toMatchObject({
      score: { p1: 7, p2: 9 },
      winner: "right",
      receiver: "right",
    });
    expect(debug.setWinner(s, null).winner).toBeNull();
    expect(() => debug.setReceiver(s, "up" as "left")).toThrow();
  });

  it("sets the paddles, drivenVy apart from vy", () => {
    let s = debug.setPaddleCy(fresh(), "right", 200);
    s = debug.setPaddleVy(s, "right", 333);
    s = debug.setPaddleDriven(s, "right", true);
    expect(snapshot(s).paddles.right).toEqual({
      cy: 200,
      vy: 0,
      drivenVy: 333,
      driven: true,
    });
    expect(snapshot(s).paddles.left.driven).toBe(false);
    expect(() => debug.setPaddleDriven(s, "left", "yes" as never)).toThrow();
  });

  it("sets each field of the ball", () => {
    let s = debug.setBallPosition(fresh(), 100, 200);
    s = debug.setBallVelocity(s, 300, -400);
    s = debug.setBallSpin(s, 250);
    s = debug.setBallHeld(s, false);
    s = debug.setBallHoldTimer(s, 0.25);
    s = debug.setBallServeSign(s, -1);
    expect(snapshot(s).ball).toMatchObject({
      x: 100,
      y: 200,
      vx: 300,
      vy: -400,
      speed: 500,
      spin: 250,
      held: false,
      holdTimer: 0.25,
      serveSign: -1,
    });
    expect([1, -1]).toContain(debug.drawBallServeSign(s).ball!.serveSign);
    expect(() => debug.setBallServeSign(s, 0 as 1)).toThrow();
  });

  it("fails loudly on every ball pose while there is no ball", () => {
    const empty = debug.clearWorld(fresh());
    expect(() => debug.setBallPosition(empty, 1, 2)).toThrow(/no ball/);
    expect(() => debug.setBallVelocity(empty, 1, 2)).toThrow();
    expect(() => debug.setBallSpin(empty, 1)).toThrow();
    expect(() => debug.setBallHeld(empty, true)).toThrow();
    expect(() => debug.setBallHoldTimer(empty, 1)).toThrow();
    expect(() => debug.setBallServeSign(empty, 1)).toThrow();
    expect(() => debug.drawBallServeSign(empty)).toThrow();
  });

  it("sets the AI faculties and the mute bit", () => {
    let s = debug.setAiTracking(fresh(), false);
    s = debug.setAiMovement(s, false);
    s = debug.setMuted(s, true);
    expect(snapshot(s)).toMatchObject({
      ai: { tracking: false, movement: false },
      muted: true,
    });
  });

  it("leaves the state it was handed as it was", () => {
    const state = fresh();
    const before = JSON.stringify(state);
    debug.setBallPosition(state, 1, 1);
    debug.setPaddleCy(state, "left", 99);
    debug.clearWorld(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("readings", () => {
  it("snapshots the declared state", () => {
    const snap = snapshot(fresh());
    expect(snap.version).toBe(CAROM_DEBUG_VERSION);
    expect(debug.version).toBe(CAROM_DEBUG_VERSION);
    expect(snap).not.toHaveProperty("menuPresses");
    expect(snap.simTime).toBe(0);
  });

  it("reports menu regions only where a menu shows", () => {
    const title = fresh();
    const rect = debug.menuItemRect(title, 2);
    expect(rect).toMatchObject({
      w: expect.any(Number),
      h: expect.any(Number),
    });
    expect(debug.menuItemRect(title, 3)).toBeNull();
    expect(debug.menuItemRect(debug.setScreen(title, "playing"), 0)).toBeNull();
    expect(
      debug.menuItemRect(debug.setScreen(title, "howto"), 0),
    ).not.toBeNull();
    expect(debug.menuItemRect(debug.setScreen(title, "howto"), 1)).toBeNull();
  });
});

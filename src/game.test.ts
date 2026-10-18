import { ConstantClock, createEngine } from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { CUES, FIELD_H, FIELD_W, LAYOUT, PADDLE_SPEED } from "./constants";
import { BACKGROUND, game } from "./game";
import type { CaromDebugApi, CaromState, Screen } from "./game";

type CaromEngine = Engine<CaromState, CaromDebugApi>;

interface Harness {
  engine: CaromEngine;
  debug: CaromDebugApi;
  key(code: string, down?: boolean): void;
  tap(code: string): void;
  pointer(type: string, x: number, y: number, pointerType?: string): void;
  cues: string[];
}

async function boot(stepMs = 1000 / 60): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const target = new EventTarget();
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(stepMs),
    surface: {
      cssWidth: () => FIELD_W,
      cssHeight: () => FIELD_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  const cues: string[] = [];
  engine.events.on("cue:played", (e) => cues.push(e.cue));
  await engine.initialize();
  const key = (code: string, down = true) =>
    target.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  return {
    engine,
    debug: engine.debug,
    cues,
    key,
    tap: (code) => {
      key(code, true);
      key(code, false);
    },
    pointer: (type, x, y, pointerType = "mouse") =>
      target.dispatchEvent(
        Object.assign(new Event(type), {
          clientX: x,
          clientY: y,
          pointerId: pointerType === "touch" ? 7 : 1,
          pointerType,
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      ),
  };
}

describe("the game under the engine", () => {
  it("opens on the title screen", async () => {
    const { engine, debug } = await boot();
    const snap = debug.snapshot(engine.state);
    expect(snap).toMatchObject({
      screen: "title",
      mode: "solo",
      menuIndex: 0,
      titleIndex: 0,
      resumeScreen: "playing",
      score: { p1: 0, p2: 0 },
      winner: null,
      receiver: "left",
      muted: false,
      simTime: 0,
      ai: { tracking: true, movement: true },
    });
    expect(snap.obstacles).toHaveLength(2);
    expect(snap.ball).toMatchObject({ held: true, holdTimer: 1 });
  });

  it("starts a Solo match from the keyboard and moves the paddle", async () => {
    const h = await boot();
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("countdown");
    h.key("KeyS");
    await h.engine.advance(1);
    expect(h.engine.state.paddles.left.vy).toBe(PADDLE_SPEED);
    h.key("KeyS", false);
    await h.engine.advance(60);
    expect(h.engine.state.screen).toBe("playing");
    expect(h.engine.state.simTime).toBeCloseTo(62 / 60);
  });

  it("opens pause with one Escape and resumes with the next", async () => {
    const h = await boot();
    h.engine.apply((s) => h.debug.setScreen(s, "playing"));
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("paused");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("paused");
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("playing");
  });

  it("toggles mute from any screen and mirrors a posed mute bit", async () => {
    const h = await boot();
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.engine.state.muted).toBe(true);
    h.engine.apply((s) => h.debug.setMuted(s, false));
    await h.engine.advance(1);
    expect(h.engine.state.muted).toBe(false);
    h.engine.apply((s) => h.debug.setMuted(s, true));
    h.engine.apply((s) => h.debug.reset(s));
    await h.engine.advance(1);
    expect(h.engine.state.muted).toBe(true);
  });

  it("confirms a menu item from a mouse click and a touch tap", async () => {
    const h = await boot();
    const rect = h.debug.menuItemRect(h.engine.state, 1)!;
    const x = rect.x + rect.w / 2;
    const y = rect.y + rect.h / 2;
    h.pointer("pointermove", x, y);
    await h.engine.advance(1);
    expect(h.engine.state.menuIndex).toBe(1);
    h.pointer("pointerdown", x, y);
    await h.engine.advance(1);
    h.pointer("pointerup", x, y);
    await h.engine.advance(1);
    expect(h.engine.state).toMatchObject({
      screen: "countdown",
      mode: "versus",
    });

    const t = await boot();
    const how = t.debug.menuItemRect(t.engine.state, 2)!;
    t.pointer("pointerdown", how.x + 10, how.y + 10, "touch");
    t.pointer("pointerup", how.x + 10, how.y + 10, "touch");
    await t.engine.advance(1);
    expect(t.engine.state.screen).toBe("howto");
  });

  it("plays a cue once per event per frame", async () => {
    const h = await boot();
    h.engine.apply((s) => h.debug.setScreen(s, "playing"));
    h.engine.apply((s) => h.debug.setBallHeld(s, false));
    h.engine.apply((s) => h.debug.setBallPosition(s, 300, 20));
    h.engine.apply((s) => h.debug.setBallVelocity(s, 0, -900));
    await h.engine.advance(1);
    expect(h.cues).toEqual([CUES.wallBounce]);
  });

  it("registers diagnostics that read the current state", async () => {
    const h = await boot();
    h.engine.apply((s) => h.debug.setBallVelocity(s, 30, 40));
    const readings = Object.fromEntries(
      h.engine.diagnostics().map((r) => [r.name, r.value]),
    );
    expect(readings).toMatchObject({
      screen: "title",
      mode: "solo",
      score: "0 - 0",
      "ball speed": "50.0",
    });
    h.engine.apply((s) => h.debug.clearWorld(s));
    const cleared = h.engine.diagnostics().find((r) => r.name === "ball pos");
    expect(cleared?.value).toBe("none");
  });

  it("renders every screen", async () => {
    const h = await boot();
    const screens: Screen[] = [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "matchover",
    ];
    h.engine.startRecording();
    for (const screen of screens) {
      h.engine.apply((s) => h.debug.setScreen(s, screen));
      h.engine.apply((s) => h.debug.setBallSpin(s, 400));
      await h.engine.advance(2);
    }
    for (const winner of ["left", "right", null] as const) {
      for (const mode of ["solo", "versus"] as const) {
        h.engine.apply((s) =>
          h.debug.setMode(h.debug.setWinner(s, winner), mode),
        );
        h.engine.apply((s) => h.debug.setMuted(s, true));
        await h.engine.advance(1);
      }
    }
    const recording = h.engine.stopRecording();
    expect(recording.frames.length).toBe(18);
    expect(recording.background).toBe(BACKGROUND);
  });
});

/** A rally posed by the debug surface, driven to a point at one step size. */
async function rally(stepMs: number) {
  const h = await boot(stepMs);
  const { engine, debug } = h;
  engine.apply((s) => debug.setMode(s, "versus"));
  engine.apply((s) => debug.setScreen(s, "playing"));
  engine.apply((s) => debug.setBallHeld(s, false));
  engine.apply((s) => debug.setBallPosition(s, 1000, 360));
  engine.apply((s) => debug.setBallVelocity(s, 520, 0));
  engine.apply((s) => debug.setBallSpin(s, 0));
  engine.apply((s) => debug.setPaddleCy(s, "right", 360));
  engine.apply((s) => debug.setPaddleDriven(s, "right", true));
  engine.apply((s) => debug.setPaddleVy(s, "right", -100));
  engine.apply((s) => debug.setPaddleDriven(s, "left", true));

  const counts = { paddle: 0, wall: 0, obstacle: 0 };
  let speed = 0;
  let frames = 0;
  while (engine.state.screen === "playing" && frames < 100000) {
    h.cues.length = 0;
    await engine.advance(1);
    frames++;
    if (h.cues.includes(CUES.paddleHit)) counts.paddle++;
    if (h.cues.includes(CUES.wallBounce)) counts.wall++;
    if (h.cues.includes(CUES.obstacleBounce)) counts.obstacle++;
    const ball = engine.state.ball;
    if (ball && !ball.held) speed = Math.hypot(ball.vx, ball.vy);
  }
  return {
    counts,
    speed,
    score: engine.state.score,
    time: engine.state.simTime,
  };
}

describe("delta-time independence", () => {
  it("reaches the same contacts and point at 2 ms and 16 ms steps", async () => {
    const fine = await rally(2);
    const coarse = await rally(16);
    expect(fine.counts.paddle).toBeGreaterThan(0);
    expect(coarse.counts).toEqual(fine.counts);
    expect(coarse.score).toEqual(fine.score);
    expect(Math.abs(coarse.speed - fine.speed)).toBeLessThan(10);
    expect(Math.abs(coarse.time - fine.time) / fine.time).toBeLessThan(0.08);
  }, 60_000);
});

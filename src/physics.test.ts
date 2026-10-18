import { describe, expect, it } from "vitest";
import {
  AI_DEADZONE,
  AI_HOME_DEADZONE,
  AI_HOME_Y,
  AI_REACT,
  AI_SPEED,
  BALL_R,
  FIELD_H,
  MAX_BOUNCE_ANGLE,
  OBSTACLES,
  P1_X1,
  P2_X0,
  PADDLE_HALF,
  PADDLE_MAX_CY,
  PADDLE_MIN_CY,
  SPEED_CAP,
  SPEED_MULT,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
  SPIN_HALFLIFE,
} from "./constants";
import type { BallState } from "./game";
import {
  advanceBall,
  aiVelocity,
  bounceOffFace,
  integratePaddle,
  paddleBounce,
  struckFace,
  substepCount,
} from "./physics";
import type { Body, PaddlesView } from "./physics";
import { allObstacles } from "./sim";

const FAR_PADDLES: PaddlesView = {
  left: { cy: 360, vy: 0 },
  right: { cy: 360, vy: 0 },
};

function body(partial: Partial<Body>): Body {
  return { x: 640, y: 360, vx: 0, vy: 0, spin: 0, ...partial };
}

function ball(partial: Partial<BallState>): BallState {
  return {
    x: 640,
    y: 360,
    vx: 0,
    vy: 0,
    spin: 0,
    held: false,
    holdTimer: 0,
    serveSign: 1,
    trail: [],
    ...partial,
  };
}

describe("integratePaddle", () => {
  it("moves at the velocity it is given", () => {
    expect(integratePaddle(360, 720, 0.1)).toEqual({ cy: 432, vy: 720 });
  });

  it("clamps to the field and reports the velocity achieved", () => {
    const top = integratePaddle(PADDLE_MIN_CY + 10, -720, 0.1);
    expect(top.cy).toBe(PADDLE_MIN_CY);
    expect(top.vy).toBeCloseTo(-100);
    const pinned = integratePaddle(PADDLE_MAX_CY, 720, 1 / 60);
    expect(pinned).toEqual({ cy: PADDLE_MAX_CY, vy: 0 });
  });

  it("keeps the velocity on a zero-length frame", () => {
    expect(integratePaddle(PADDLE_MAX_CY, 720, 0)).toEqual({
      cy: PADDLE_MAX_CY,
      vy: 720,
    });
  });
});

describe("aiVelocity", () => {
  const ai = { tracking: true, movement: true };

  it("tracks the ball's lagged position while it approaches in play", () => {
    const view = { playing: true, ball: ball({ y: 600, vx: 300, vy: 100 }) };
    const target = 600 - 100 * AI_REACT;
    expect(aiVelocity(ai, 360, view, 1 / 60)).toBe(AI_SPEED);
    const close = aiVelocity(ai, target - 20, view, 0.1);
    expect(close).toBeCloseTo(200);
  });

  it("stops inside the defending dead zone", () => {
    const view = { playing: true, ball: ball({ y: 400, vx: 300 }) };
    expect(aiVelocity(ai, 400 - AI_DEADZONE, view, 1 / 60)).toBe(0);
  });

  it("returns home while the ball moves away or the screen is not playing", () => {
    const away = { playing: true, ball: ball({ y: 600, vx: -300 }) };
    expect(aiVelocity(ai, 100, away, 1 / 60)).toBe(AI_SPEED);
    const countdown = { playing: false, ball: ball({ y: 600, vx: 300 }) };
    expect(aiVelocity(ai, 600, countdown, 1 / 60)).toBe(-AI_SPEED);
    expect(aiVelocity(ai, AI_HOME_Y + AI_HOME_DEADZONE, away, 1 / 60)).toBe(0);
  });

  it("is gated by tracking and movement", () => {
    const view = { playing: true, ball: ball({ y: 600, vx: 300 }) };
    expect(
      aiVelocity({ tracking: false, movement: true }, 360, view, 0.1),
    ).toBe(0);
    expect(
      aiVelocity({ tracking: true, movement: false }, 100, view, 0.1),
    ).toBe(0);
  });
});

describe("struckFace", () => {
  const rect = { x0: 100, x1: 120, y0: 100, y1: 200 };

  it("is null outside the expanded rectangle and on its edge", () => {
    expect(struckFace(100 - BALL_R, 150, rect)).toBeNull();
    expect(struckFace(50, 150, rect)).toBeNull();
  });

  it("picks the shallowest face", () => {
    expect(struckFace(92, 150, rect)).toBe("left");
    expect(struckFace(128, 150, rect)).toBe("right");
    expect(struckFace(110, 92, rect)).toBe("top");
    expect(struckFace(110, 208, rect)).toBe("bottom");
  });

  it("breaks ties in the order left, right, top, bottom", () => {
    const square = { x0: 0, x1: 20, y0: 0, y1: 20 };
    expect(struckFace(10, 10, square)).toBe("left");
    expect(struckFace(25, 25, square)).toBe("right");
  });

  it("places the ball off the face and reverses only an inbound velocity", () => {
    const b = body({ x: 92, y: 150, vx: 100, vy: 5 });
    bounceOffFace(b, rect, "left");
    expect(b).toMatchObject({ x: 100 - BALL_R, vx: -100, vy: 5 });
    const outbound = body({ x: 128, y: 150, vx: 100 });
    bounceOffFace(outbound, rect, "right");
    expect(outbound).toMatchObject({ x: 120 + BALL_R, vx: 100 });
    const top = body({ y: 92, vy: 50 });
    bounceOffFace(top, rect, "top");
    expect(top).toMatchObject({ y: 100 - BALL_R, vy: -50 });
    const bottom = body({ y: 208, vy: -50 });
    bounceOffFace(bottom, rect, "bottom");
    expect(bottom).toMatchObject({ y: 200 + BALL_R, vy: 50 });
  });
});

describe("paddleBounce", () => {
  it("sends a centre hit straight back, faster", () => {
    const b = body({ x: P2_X0 - 5, y: 360, vx: 500, vy: 0 });
    paddleBounce(b, "right", 360, 0);
    expect(b.vx).toBeCloseTo(-500 * SPEED_MULT);
    expect(b.vy).toBeCloseTo(0);
    expect(b.x).toBe(P2_X0 - BALL_R);
  });

  it("angles an edge hit at the maximum bounce angle", () => {
    const b = body({ x: P1_X1 + 5, y: 360 - PADDLE_HALF - 5, vx: -500 });
    paddleBounce(b, "left", 360, 0);
    const speed = 500 * SPEED_MULT;
    expect(b.vx).toBeCloseTo(speed * Math.cos(MAX_BOUNCE_ANGLE));
    expect(b.vy).toBeCloseTo(-speed * Math.sin(MAX_BOUNCE_ANGLE));
    expect(b.x).toBe(P1_X1 + BALL_R);
  });

  it("caps the speed and adds clamped spin from paddle motion", () => {
    const b = body({ vx: -SPEED_CAP, spin: 100 });
    paddleBounce(b, "left", 360, 400);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(SPEED_CAP);
    expect(b.spin).toBeCloseTo(100 + 400 * SPIN_FROM_PADDLE);
    const fast = body({ vx: -500, spin: 800 });
    paddleBounce(fast, "left", 360, 720);
    expect(fast.spin).toBe(SPIN_CLAMP);
  });
});

describe("advanceBall", () => {
  it("cuts a frame into sub-steps of at most four units", () => {
    expect(substepCount(0, 1 / 60)).toBe(1);
    expect(substepCount(960, 1 / 60)).toBe(4);
    expect(substepCount(980, 0.1)).toBe(25);
  });

  it("flies straight without spin", () => {
    const { body: b } = advanceBall(
      body({ vx: 600, vy: 0 }),
      FAR_PADDLES,
      [],
      0.1,
    );
    expect(b.x).toBeCloseTo(700);
    expect(b.y).toBeCloseTo(360);
  });

  it("curves clockwise with positive spin, keeping its speed", () => {
    const { body: b } = advanceBall(
      body({ x: 300, vx: 600, spin: 600 }),
      FAR_PADDLES,
      [],
      0.2,
    );
    expect(b.vy).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(360);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(600);
    expect(b.spin).toBeCloseTo(600 * Math.pow(0.5, 0.2 / SPIN_HALFLIFE));
  });

  it("reflects off the walls and reports it", () => {
    const { body: b, events } = advanceBall(
      body({ y: FIELD_H - BALL_R - 1, vx: 0, vy: 300 }),
      FAR_PADDLES,
      [],
      1 / 60,
    );
    expect(b.vy).toBe(-300);
    expect(b.y).toBeLessThanOrEqual(FIELD_H - BALL_R);
    expect(events.wallBounce).toBe(true);
    const top = advanceBall(
      body({ y: BALL_R + 1, vy: -300 }),
      FAR_PADDLES,
      [],
      1 / 60,
    );
    expect(top.body.vy).toBe(300);
    expect(top.body.y).toBeGreaterThanOrEqual(BALL_R);
  });

  it("returns off a paddle face and caps off its end", () => {
    const hit = advanceBall(
      body({ x: P2_X0 - BALL_R - 2, y: 360, vx: 600 }),
      FAR_PADDLES,
      [],
      1 / 60,
    );
    expect(hit.events.paddleHit).toBe(true);
    expect(hit.body.vx).toBeLessThan(0);

    const cap = advanceBall(
      body({ x: 1224, y: 360 - PADDLE_HALF - BALL_R - 1, vx: 0, vy: 300 }),
      FAR_PADDLES,
      [],
      1 / 60,
    );
    expect(cap.events.wallBounce).toBe(true);
    expect(cap.events.paddleHit).toBe(false);
    expect(cap.body.vy).toBe(-300);
  });

  it("banks off a present obstacle and ignores an absent one", () => {
    const a = OBSTACLES[0];
    const start = body({ x: a.x0 - BALL_R - 2, y: 220, vx: 600 });
    const banked = advanceBall(start, FAR_PADDLES, allObstacles(), 1 / 60);
    expect(banked.events.obstacleBounce).toBe(true);
    expect(banked.body.vx).toBe(-600);
    expect(Math.hypot(banked.body.vx, banked.body.vy)).toBeCloseTo(600);
    const open = advanceBall(start, FAR_PADDLES, [], 1 / 60);
    expect(open.events.obstacleBounce).toBe(false);
    expect(open.body.vx).toBe(600);
  });

  it("never tunnels through an obstacle at the speed cap", () => {
    const b = OBSTACLES[1];
    const start = body({ x: b.x0 - 40, y: 500, vx: SPEED_CAP });
    const { body: out } = advanceBall(start, FAR_PADDLES, allObstacles(), 0.1);
    expect(out.x).toBeLessThan(b.x0);
  });
});

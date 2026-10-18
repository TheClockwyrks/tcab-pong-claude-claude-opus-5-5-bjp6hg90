// Carom — the values the engine's debug overlay shows (specs/instrumentation.md).
// Every source is a pure read of the state it is handed.

import type { InitApi } from "@clockwyrks/simple-2d";
import type { CaromState } from "./game";

const fmt = (value: number): string => value.toFixed(1);

export function registerDiagnostics(
  diagnostics: InitApi<CaromState>["diagnostics"],
): void {
  diagnostics.register("screen", (s) => s.screen);
  diagnostics.register("mode", (s) => s.mode);
  diagnostics.register("score", (s) => `${s.score.p1} - ${s.score.p2}`);
  diagnostics.register("ball pos", (s) =>
    s.ball ? `${fmt(s.ball.x)}, ${fmt(s.ball.y)}` : "none",
  );
  diagnostics.register("ball vel", (s) =>
    s.ball ? `${fmt(s.ball.vx)}, ${fmt(s.ball.vy)}` : "none",
  );
  diagnostics.register("ball speed", (s) =>
    s.ball ? fmt(Math.hypot(s.ball.vx, s.ball.vy)) : "none",
  );
  diagnostics.register("ball spin", (s) =>
    s.ball ? fmt(s.ball.spin) : "none",
  );
  diagnostics.register(
    "left paddle",
    (s) => `cy ${fmt(s.paddles.left.cy)} vy ${fmt(s.paddles.left.vy)}`,
  );
  diagnostics.register(
    "right paddle",
    (s) => `cy ${fmt(s.paddles.right.cy)} vy ${fmt(s.paddles.right.vy)}`,
  );
}

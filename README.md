# Carom

Carom is a top-down paddle duel that runs entirely in the browser. Two paddles
face each other across a dark field while a ball ricochets between them, off
the top and bottom walls, and off two fixed obstacles in the middle of the
field. Score by getting the ball past the far edge behind your opponent.

Its signature mechanic is **spin**: the motion of your paddle at the moment it
strikes the ball curves the ball's flight afterwards. Combined with the two
obstacles, every return is a bank shot waiting to happen. First to 11 wins, by
two clear points.

- **Solo** — you play the left paddle against a CPU opponent.
- **Versus** — two players share one keyboard.

Everything is drawn in code on a canvas and every sound is synthesized; the
build ships no art or audio files and needs no backend. It is built on the
Simple 2D engine (documented under `engine/`).

## Requirements

Node.js 20 or newer and npm.

## Install

```sh
npm ci
```

## Run in development

```sh
npm run dev
```

Vite serves the game with hot reload and prints the local URL (by default
<http://localhost:5173/>).

## Production build

```sh
npm run build
```

This type-checks and writes the complete static site to `dist/`, with
`index.html` at its root. Serve that directory as-is from any static file
server; `npm run preview` serves it locally at <http://localhost:4173/>.

## Controls

| Action                   | Keys                                             |
| ------------------------ | ------------------------------------------------ |
| Player one (left) up     | `W`                                              |
| Player one (left) down   | `S`                                              |
| Player two (right) up    | `↑`                                              |
| Player two (right) down  | `↓`                                              |
| Menu up / down           | `W` / `S` or `↑` / `↓`                           |
| Select                   | `Enter` or `Space`                               |
| Back                     | `Esc`                                            |
| Pause / resume           | `P` or `Esc`                                     |
| Mute / unmute            | `M`                                              |
| Debug overlay            | `` ` `` (backtick)                               |

In Solo, either pair of movement keys moves your (left) paddle. The menus also
take the mouse and touch: hover or touch an item to select it, click or tap it
to confirm. On a touchscreen the engine shows a slider along each side for the
paddles and menu buttons along the top.

**Spin:** move your paddle as it strikes the ball and the ball curves in the
direction you moved — a down-swing curves it downward, an up-swing upward. Spin
fades over time but survives wall and obstacle bounces. Where the ball meets
the paddle sets its angle: near the ends for a steep shot, the centre to drive
it flat. Every return speeds the ball up.

## Development

| Command             | Does                                                 |
| ------------------- | ---------------------------------------------------- |
| `npm test`          | Runs the Vitest suite (`src/**/*.test.ts`) in Node, with coverage. |
| `npm run typecheck` | `tsc --noEmit`.                                      |
| `npm run lint`      | ESLint.                                              |
| `npm run format`    | Prettier, in check mode.                             |

The source lives in `src/`:

- `game.ts` — the `CaromState` contract and the `game` the engine drives.
- `sim.ts` — the frame transition: menus, match flow, serving, scoring.
- `physics.ts` — paddle integration, the AI, and the sub-stepped ball flight.
- `menus.ts` — menu items and their hit regions.
- `input.ts` — one frame's input, read the way each screen reads it.
- `render.ts` — all drawing.
- `debug.ts` — the debug and automation surface (`engine.debug`).
- `diagnostics.ts` — the values shown on the engine's debug overlay.

The figures the specification fixes live in `src/constants.ts`.

### Showcase

`showcase/` holds the store-page description, the carousel manifest, and its
media. To regenerate the media:

```sh
node scripts/record-replay.mjs           # showcase/rally.json.gz
npm run build && npx vite preview --port 4173 &
node scripts/capture-screenshots.mjs     # showcase/*.png
```

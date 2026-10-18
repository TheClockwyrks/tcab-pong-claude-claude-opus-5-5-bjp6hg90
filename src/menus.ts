// Carom — the menus: which items each screen shows and where their hit regions
// lie (specs/ui.md). The renderer draws each item inside the region reported
// here, so what a pointer selects is exactly what the player sees.

import {
  FIELD_CX,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./game";

/** A hit region in logical units, `x` and `y` its top-left corner. */
export interface MenuRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The copy of the how-to screen's single item, which returns to the title. */
export const HOWTO_ITEMS = ["BACK TO MENU"] as const;

export const MENU_ITEM_W = 360;
export const MENU_ITEM_H = 54;
const MENU_ITEM_GAP = 14;

/** The y of the first item's top edge on each menu screen. */
const MENU_TOP: Readonly<Record<MenuScreen, number>> = {
  title: 380,
  howto: 610,
  paused: 300,
  matchover: 430,
};

export type MenuScreen = "title" | "howto" | "paused" | "matchover";

export function isMenuScreen(screen: Screen): screen is MenuScreen {
  return (
    screen === "title" ||
    screen === "howto" ||
    screen === "paused" ||
    screen === "matchover"
  );
}

/** The items the menu on `screen` shows, or an empty list for no menu. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "howto":
      return HOWTO_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "matchover":
      return MATCHOVER_ITEMS;
    default:
      return [];
  }
}

/** The hit region of item `index` on `screen`'s menu, or `null` for none. */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  if (!isMenuScreen(screen)) return null;
  const count = menuItems(screen).length;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  return {
    x: FIELD_CX - MENU_ITEM_W / 2,
    y: MENU_TOP[screen] + index * (MENU_ITEM_H + MENU_ITEM_GAP),
    w: MENU_ITEM_W,
    h: MENU_ITEM_H,
  };
}

/** The item on `screen`'s menu whose region contains `(x, y)`, or `null`. */
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const count = menuItems(screen).length;
  for (let i = 0; i < count; i++) {
    const r = menuItemRect(screen, i);
    if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return null;
}

/** `index` moved by `step` over `count` items, wrapping both ways. */
export function wrapIndex(index: number, step: number, count: number): number {
  const base = Number.isInteger(index) ? index : 0;
  return (((base + step) % count) + count) % count;
}

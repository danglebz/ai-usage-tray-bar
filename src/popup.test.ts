import { expect, it } from "vitest";
import { mergeCardOrder, orderCards, popupLayout, savedPosition } from "./popup.ts";

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const tray = { x: 1860, y: 1040, width: 24, height: 40 };

it("restores the user's taller height above the taskbar instead of resetting it", () => {
  const layout = popupLayout(tray, area, 900);
  expect(layout.bounds).toEqual({ x: 1512, y: 132, width: 400, height: 900 });
  expect(layout.minHeight).toBe(320);
  expect(layout.maxHeight).toBe(1024);
});

it("keeps a saved tall panel reachable on a smaller display", () => {
  const layout = popupLayout({ ...tray, y: 560 }, { ...area, height: 560 }, 900);
  expect(layout.bounds.height).toBe(544);
  expect(layout.bounds.y).toBe(8);
});

it("opens under a top taskbar on a display with negative coordinates", () => {
  const layout = popupLayout(
    { x: -1880, y: -40, width: 24, height: 40 },
    { x: -1920, y: 0, width: 1920, height: 1080 },
    750,
  );
  expect(layout.bounds).toEqual({ x: -1912, y: 8, width: 400, height: 750 });
});

it("keeps the panel usable at its minimum height", () => {
  expect(popupLayout(tray, area, 50).bounds.height).toBe(320);
});

it("fits even when the available work area is shorter than the minimum", () => {
  const layout = popupLayout(tray, { ...area, height: 240 }, 620);
  expect(layout.bounds.height).toBe(224);
  expect(layout.minHeight).toBe(224);
});

it.each([undefined, null, "900", -1, NaN, Infinity])("uses a safe default for invalid saved height %s", (height) => {
  expect(popupLayout(tray, area, height).bounds.height).toBe(620);
});

it("opens a dragged panel where it was dropped instead of by the tray", () => {
  const layout = popupLayout(tray, area, 600, { x: 300, y: 120 });
  expect(layout.bounds).toEqual({ x: 300, y: 120, width: 400, height: 600 });
});

it("keeps a panel parked flush against an edge flush, with no margin added", () => {
  expect(popupLayout(tray, area, 600, { x: 0, y: 0 }).bounds).toMatchObject({ x: 0, y: 0 });
  expect(popupLayout(tray, area, 600, { x: 1520, y: 440 }).bounds).toMatchObject({ x: 1520, y: 440 });
});

it("pulls a panel dropped past the edge, or saved on a bigger display, back fully on screen", () => {
  expect(popupLayout(tray, area, 600, { x: 1800, y: 900 }).bounds).toMatchObject({ x: 1520, y: 440 });
  expect(popupLayout(tray, area, 600, { x: -500, y: -80 }).bounds).toMatchObject({ x: 0, y: 0 });
});

it("places a saved position on a display with negative coordinates", () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  expect(popupLayout(tray, left, 600, { x: -1000, y: 200 }).bounds).toMatchObject({ x: -1000, y: 200 });
});

it.each([null, undefined, "300,120", { x: 300 }, { x: "300", y: 120 }, { x: NaN, y: 1 }, [300, 120]])(
  "falls back to the tray anchor for an unusable saved position %s",
  (position) => {
    expect(savedPosition(position)).toBeNull();
    expect(popupLayout(tray, area, 900, position).bounds).toEqual(popupLayout(tray, area, 900).bounds);
  },
);

it("sorts cards by the saved order and keeps unknown ones in their original order at the end", () => {
  const cards = ["claude", "codex", "copilot", "gemini", "fal"].map((id) => ({ id }));
  expect(orderCards(cards, ["gemini", "claude"]).map((c) => c.id)).toEqual([
    "gemini",
    "claude",
    "codex",
    "copilot",
    "fal",
  ]);
  expect(orderCards(cards, []).map((c) => c.id)).toEqual(["claude", "codex", "copilot", "gemini", "fal"]);
});

it("remembers where hidden providers were when the panel sends only the visible ones", () => {
  expect(mergeCardOrder(["fal", "claude"], ["claude", "codex", "fal"])).toEqual(["fal", "claude", "codex"]);
});

it.each([undefined, null, "claude", 42, { 0: "claude" }])("ignores an order that is not a list (%s)", (bad) => {
  expect(mergeCardOrder(bad, ["claude"])).toEqual(["claude"]);
  expect(mergeCardOrder(["codex"], bad)).toEqual(["codex"]);
});

it("drops non-string and duplicate ids from a saved order", () => {
  expect(mergeCardOrder(["codex", 7, null, "codex", "claude"], [])).toEqual(["codex", "claude"]);
});

import { expect, it } from "vitest";
import { popupLayout } from "./popup.ts";

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

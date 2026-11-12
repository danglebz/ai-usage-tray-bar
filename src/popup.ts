import { isObject, num, str } from "./providers/_util.ts";

export const POPUP_WIDTH = 400;
export const DEFAULT_POPUP_HEIGHT = 620;
const MIN_POPUP_HEIGHT = 320;
const MARGIN = 8;
/** More ids than any real provider list; caps what a renderer can make the config store. */
const MAX_CARD_ORDER = 100;

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** Where the user last dropped the panel, or null when nothing usable was saved. */
export function savedPosition(value: unknown): Point | null {
  if (!isObject(value)) return null;
  const x = num(value.x);
  const y = num(value.y);
  return x == null || y == null ? null : { x: Math.round(x), y: Math.round(y) };
}

/**
 * Restore the chosen height while keeping the panel inside the work area. Without a saved
 * position the panel sits by the tray icon; with one it opens where the user left it, pulled
 * back far enough to be fully visible (the display may have changed since).
 */
export function popupLayout(tray: Rectangle, area: Rectangle, preferredHeight: unknown, position: unknown = null) {
  const width = Math.max(1, Math.min(POPUP_WIDTH, area.width - MARGIN * 2));
  const maxHeight = Math.max(1, area.height - MARGIN * 2);
  const minHeight = Math.min(MIN_POPUP_HEIGHT, maxHeight);
  const requested =
    typeof preferredHeight === "number" && Number.isFinite(preferredHeight) && preferredHeight > 0
      ? Math.round(preferredHeight)
      : DEFAULT_POPUP_HEIGHT;
  const height = Math.max(minHeight, Math.min(requested, maxHeight));

  const saved = savedPosition(position);
  if (saved) {
    // No margin here: a panel the user parked flush against an edge stays flush.
    const x = Math.max(area.x, Math.min(saved.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(saved.y, area.y + area.height - height));
    return { bounds: { x, y, width, height }, minHeight, maxHeight };
  }

  const x = Math.max(
    area.x + MARGIN,
    Math.min(Math.round(tray.x + tray.width / 2 - width / 2), area.x + area.width - width - MARGIN),
  );
  const anchorY =
    tray.y >= area.y + area.height ? area.y + area.height - height - MARGIN : tray.y + tray.height + MARGIN;
  const y = Math.max(area.y + MARGIN, Math.min(anchorY, area.y + area.height - height - MARGIN));
  return { bounds: { x, y, width, height }, minHeight, maxHeight };
}

/**
 * The card order to store after a drag. The panel only shows enabled providers, so ids it did
 * not send keep their earlier relative order after the ones it did: switching a provider off
 * and on again must not throw away where the user had put it. Both inputs are untrusted (the
 * renderer, a hand-edited config.json), so anything that is not a list of strings is dropped.
 */
export function mergeCardOrder(next: unknown, previous: unknown = []): string[] {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const order: string[] = [];
  for (const id of [...list(next), ...list(previous)]) {
    const s = str(id);
    if (s && !order.includes(s)) order.push(s);
  }
  return order.slice(0, MAX_CARD_ORDER);
}

/** Sort cards by `order`; ids it does not mention keep their current relative order at the end. */
export function orderCards<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  // Unknown ids all share the last rank; sort is stable, so they keep the order they came in.
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

export const POPUP_WIDTH = 400;
export const DEFAULT_POPUP_HEIGHT = 620;
const MIN_POPUP_HEIGHT = 320;
const MARGIN = 8;

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Restore the chosen height while keeping the panel inside the tray display's work area. */
export function popupLayout(tray: Rectangle, area: Rectangle, preferredHeight: unknown) {
  const width = Math.max(1, Math.min(POPUP_WIDTH, area.width - MARGIN * 2));
  const maxHeight = Math.max(1, area.height - MARGIN * 2);
  const minHeight = Math.min(MIN_POPUP_HEIGHT, maxHeight);
  const requested =
    typeof preferredHeight === "number" && Number.isFinite(preferredHeight) && preferredHeight > 0
      ? Math.round(preferredHeight)
      : DEFAULT_POPUP_HEIGHT;
  const height = Math.max(minHeight, Math.min(requested, maxHeight));
  const x = Math.max(
    area.x + MARGIN,
    Math.min(Math.round(tray.x + tray.width / 2 - width / 2), area.x + area.width - width - MARGIN),
  );
  const anchorY =
    tray.y >= area.y + area.height ? area.y + area.height - height - MARGIN : tray.y + tray.height + MARGIN;
  const y = Math.max(area.y + MARGIN, Math.min(anchorY, area.y + area.height - height - MARGIN));
  return { bounds: { x, y, width, height }, minHeight, maxHeight };
}

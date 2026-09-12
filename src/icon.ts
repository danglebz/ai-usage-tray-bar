// Tray icon drawn from raw pixels: a ring whose filled arc is the highest "used %" across
// providers, coloured by severity. No image assets, no canvas, works at any DPI.

import { nativeImage, type NativeImage } from "electron";
import type { Severity } from "./types.ts";

type Rgb = readonly [number, number, number];

const COLORS: Record<Severity | "track", Rgb> = {
  normal: [0x4a, 0xde, 0x80], // green
  warning: [0xfb, 0xbf, 0x24], // amber
  critical: [0xf8, 0x71, 0x71], // red
  unknown: [0x9c, 0xa3, 0xaf], // gray
  track: [0x6b, 0x72, 0x80],
};

// 4× supersampling per pixel for a smooth edge at 16px.
const SAMPLES: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

/** Draw a size×size BGRA bitmap (Electron's createFromBitmap expects BGRA on Windows). */
export function drawRing(size: number, percent: number | null, sev: Severity): Buffer {
  const buf = Buffer.alloc(size * size * 4, 0);
  const c = size / 2;
  const rOuter = size / 2 - 0.5;
  const rInner = size * 0.3;
  const frac = percent == null ? 0 : Math.max(0, Math.min(1, percent / 100));
  const [fr, fg, fb] = COLORS[sev] ?? COLORS.unknown;
  const [tr, tg, tb] = COLORS.track;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      let filled = 0;
      for (const [dx, dy] of SAMPLES) {
        const px = x + dx - c;
        const py = y + dy - c;
        const d = Math.hypot(px, py);
        if (d > rOuter || d < rInner) continue;
        cover++;
        // Angle from 12 o'clock, clockwise.
        let a = Math.atan2(px, -py);
        if (a < 0) a += Math.PI * 2;
        if (a / (Math.PI * 2) <= frac) filled++;
      }
      if (!cover) continue;
      const alpha = Math.round((cover / 4) * 255);
      const f = filled / cover;
      const r = Math.round(fr * f + tr * (1 - f));
      const g = Math.round(fg * f + tg * (1 - f));
      const b = Math.round(fb * f + tb * (1 - f));
      const i = (y * size + x) * 4;
      // Premultiplied alpha keeps the edge clean on light and dark taskbars.
      buf[i] = Math.round((b * alpha) / 255);
      buf[i + 1] = Math.round((g * alpha) / 255);
      buf[i + 2] = Math.round((r * alpha) / 255);
      buf[i + 3] = alpha;
    }
  }
  return buf;
}

export function ringIcon(percent: number | null, sev: Severity): NativeImage {
  const img = nativeImage.createEmpty();
  for (const [size, scale] of [
    [16, 1],
    [32, 2],
    [48, 3],
  ] as const) {
    img.addRepresentation({ width: size, height: size, scaleFactor: scale, buffer: drawRing(size, percent, sev) });
  }
  return img;
}

// Builds assets/icon.ico from the project logo (run under Electron: `pnpm icon`).
// ICO may embed PNG frames directly (Vista+).

import { app, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";

interface Frame {
  size: number;
  buf: Buffer;
}

function ico(pngs: Frame[]): Buffer {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size; // width (0 = 256)
    dir[o + 1] = size >= 256 ? 0 : size; // height
    dir[o + 2] = 0; // palette
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

void app.whenReady().then(() => {
  const assets = path.join(import.meta.dirname, "..", "assets");
  const source = nativeImage.createFromPath(path.join(assets, "icon.png"));
  if (source.isEmpty()) throw new Error("assets/icon.png could not be loaded");
  const pngs = [16, 24, 32, 48, 64, 128, 256].map((size) => {
    const img = source.resize({ width: size, height: size, quality: "best" });
    return { size, buf: img.toPNG() };
  });
  const out = path.join(assets, "icon.ico");
  const bytes = ico(pngs);
  fs.writeFileSync(out, bytes);
  console.log("wrote", out, bytes.length, "bytes");
  app.quit();
});

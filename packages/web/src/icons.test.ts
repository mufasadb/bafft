import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// bafft-ijv: index.html points at the icons in public/, and each one is a
// real PNG of the size its <link> claims (Unraid's template uses /icon.png).
const web = join(__dirname, "..");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function pngSize(file: string) {
  const buf = readFileSync(join(web, "public", file));
  expect([...buf.subarray(0, 4)]).toEqual(PNG_SIGNATURE);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("app icons", () => {
  const html = readFileSync(join(web, "index.html"), "utf8");

  it.each([
    ["favicon.png", 32],
    ["icon.png", 512],
    ["apple-touch-icon.png", 180],
  ])("%s is linked from index.html and is %ipx square", (file, size) => {
    expect(html).toContain(`href="/${file}"`);
    expect(pngSize(file)).toEqual({ width: size, height: size });
  });
});

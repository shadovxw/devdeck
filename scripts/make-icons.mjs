// Renders build/appicon.svg into build/appicon.png (1024 px) and build/windows/icon.ico
// (16 to 256 px, PNG-compressed entries). The outputs are committed; run this only when
// the icon changes:
//   npm install --no-save --prefix .tmp-icons @resvg/resvg-js
//   node scripts/make-icons.mjs   (then delete .tmp-icons)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../.tmp-icons/", import.meta.url));
const { Resvg } = require("@resvg/resvg-js");

const svg = readFileSync(new URL("../build/appicon.svg", import.meta.url));
const png = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

mkdirSync(new URL("../build/windows/", import.meta.url), { recursive: true });
writeFileSync(new URL("../build/appicon.png", import.meta.url), png(1024));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => ({ s, data: png(s) }));
const head = Buffer.alloc(6 + 16 * images.length);
head.writeUInt16LE(0, 0); // reserved
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(images.length, 4);
let offset = head.length;
images.forEach(({ s, data }, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s === 256 ? 0 : s, e); // width (0 means 256)
  head.writeUInt8(s === 256 ? 0 : s, e + 1);
  head.writeUInt8(0, e + 2); // colours in palette
  head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); // colour planes
  head.writeUInt16LE(32, e + 6); // bits per pixel
  head.writeUInt32LE(data.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
writeFileSync(new URL("../build/windows/icon.ico", import.meta.url), Buffer.concat([head, ...images.map((i) => i.data)]));
console.log("wrote build/appicon.png and build/windows/icon.ico");

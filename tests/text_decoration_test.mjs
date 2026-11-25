// Underline and strikethrough are drawn: CoreText read them and laid the text out the complex
// way for them, but CanvasPaintContext dropped both flags, so the text painted plain. Each line
// now gets a bar its own width in the text colour, as the C++ player draws it: through the
// lowercase letters for strikethrough, just below the baseline for underline.
//
//   node tests/text_decoration_test.mjs   (after building build-node/node-entry.js)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createCanvas } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const { convert } = createRequire(import.meta.url)(path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build", "Parser.js"));

const W = 300, H = 60;
// "a a a a a a": the spaces leave every plain row mostly empty, so a bar the line's width is
// a row far redder than any the glyphs make.
function render(extra) {
    const bytes = convert({
        header: { width: W, height: H, profiles: 513 },
        root: { box: { modifiers: ["fillMaxSize", { background: "#FFFFFF" }], children: [
            { text: { value: "a a a a a a", fontSize: 30, color: "#FF0000", ...extra } }] } },
    });
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    doc.setWidth(W); doc.setHeight(H);
    const g = createCanvas(W, H).getContext("2d");
    const paint = new CanvasPaintContext(null, g);
    const ctx = new WebRemoteContext(paint);
    ctx.mWidth = W; ctx.mHeight = H;
    doc.initializeContext(ctx); ctx.setPaintContext(paint); paint.setContext(ctx);
    doc.applyDataOperations(ctx);
    for (let i = 0; i < 3; i++) doc.paint(ctx, -1);
    const px = g.getImageData(0, 0, W, H).data;
    // Red pixels per row.
    const rows = [];
    for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (px[i] > 180 && px[i + 1] < 90 && px[i + 2] < 90) n++; }
        rows.push(n);
    }
    return rows;
}

const plain = render({});
const textW = Math.max(...plain); // the widest row of plain glyph ink
const width = (rows) => Math.max(...rows);
const strike = render({ strikethrough: true });
const under = render({ underline: true });
const both = render({ underline: true, strikethrough: true });

const barRows = (rows) => rows.map((n, y) => [n, y]).filter(([n]) => n > textW * 1.5 && n > 100).map(([, y]) => y);
assert.equal(barRows(plain).length, 0, "plain text has no bar");
const s = barRows(strike), u = barRows(under), b = barRows(both);
assert.ok(s.length > 0, `strikethrough draws a bar (widest row ${width(strike)} vs ${textW})`);
assert.ok(u.length > 0, `underline draws a bar (widest row ${width(under)} vs ${textW})`);
assert.ok(Math.min(...u) > Math.max(...s), `the underline (rows ${u}) sits below the strike (rows ${s})`);
assert.ok(b.some((y) => s.includes(y)) && b.some((y) => u.includes(y)), "both together draw both bars");
// The strike crosses the letters: an "a" has ink above and below it.
const sy = s[0], inkAbove = plain.slice(0, sy).some((n) => n > 0), inkBelow = plain.slice(sy + 2).some((n) => n > 0);
assert.ok(inkAbove && inkBelow, `the strike (row ${sy}) runs through the glyphs`);
console.log("text_decoration_test: ok", { strike: s, underline: u });

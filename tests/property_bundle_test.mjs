// What androidx added to the player since ebe7964173e, in one document:
//   MODIFIER_PROPERTY_BUNDLE (95) + PROPERTY_BUNDLE_LOOKUP (96)   0d0f5ab0f6d, 7a96775051d, 70ac8c200f4
//   MODIFIER_CLIP_PATH (109)                                      a34763e67a6
// and, outside the document, inline TYPE_RAW8888 / TYPE_RAW8 bitmaps (5cf83e490d6's decoder).
//
// The document mirrors androidx's PropertyBundleLookupOperationTest ("CoreDocument resolves present
// properties..."): a column (id 1) with a bundle {100: 7}; a box (2) with {15: 40, 20: -12} whose
// content looks up 15 (40), 999 (default -99) and the column's 100 (7), and adds two of them (47);
// a box (3) with no bundle (default 123) and a lookup of a missing component (default 456); a
// canvas (4) whose canvas content reads the canvas's bundle {30: 88}. Then the property's variable
// changes (40 -> 30) and the lookup and its sum follow. Last, a 100x100 red box clipped to the
// triangle (0,0) (100,0) (0,100): red above the diagonal, nothing below it.
// The C++ player reads the same bytes (WRITE_FIXTURE=<kobento-libs>/tests/fixtures/property_bundle.rc).
//
//   node tests/property_bundle_test.mjs   (after building build-node/node-entry.js and json2rc)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const require = createRequire(path.join(root, "package.json"));
const { createCanvas } = require("canvas");
// node-canvas has no Path2D: this one records its commands, and clip(path) below replays them,
// so the clip is a real one.
globalThis.Path2D = class {
    constructor() { this.cmds = []; }
    addPath(p) { this.cmds.push(...(p?.cmds ?? [])); }
};
for (const m of ["moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "arc", "rect", "closePath"]) {
    globalThis.Path2D.prototype[m] = function (...a) { this.cmds.push([m, a]); };
}
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const J2R = path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build");
const { Writer, modPropertyBundle, modClipPath, modWidth, modHeight, modBackground, TYPE_EXACT } = require(path.join(J2R, "Writer.js"));
const { HEADER_KEY_TO_TAG } = require(path.join(J2R, "Header.js"));
const { parseSvgPath } = require(path.join(J2R, "Parser.js"));

const W = 300, H = 300;
const f32 = (v) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); return b.getInt32(0); };
const size = (w, h) => [modWidth(TYPE_EXACT, f32(w)), modHeight(TYPE_EXACT, f32(h))];
const I_ADD = 0x10001;

const w = new Writer(7, [[HEADER_KEY_TO_TAG.width, W], [HEADER_KEY_TO_TAG.height, H]], 0x201);
const v7 = w.addInteger(7), v40 = w.addInteger(40), vNeg12 = w.addInteger(-12), v88 = w.addInteger(88);
const triangle = w.addPathData(parseSvgPath("M0,0 L100,0 L0,100 Z"));
const out = {};
for (const k of ["implicit", "missingProperty", "explicitParent", "sum", "noBundle", "noComponent", "canvas"]) out[k] = w.allocDataId();
const lookup = (key, componentId, propertyId, dflt) => w.propertyBundleLookup(out[key], componentId, propertyId, dflt);
const intExpression = (id, mask, values) => {
    w.buffer.start(144); w.buffer.writeInt(id); w.buffer.writeInt(mask); w.buffer.writeInt(values.length);
    for (const v of values) w.buffer.writeInt(v);
};

w.rootStart();
w.componentIdOverride = 1;
w.startColumn(0, 0, [modPropertyBundle(10, 0, [100], [v7])]);
    w.componentIdOverride = 2;
    w.startBox(0, 0, [...size(100, 50), modPropertyBundle(11, 10, [15, 20], [v40, vNeg12])]);
        lookup("implicit", -1, 15, -1);
        lookup("missingProperty", -1, 999, -99);
        lookup("explicitParent", 1, 100, -1);
        intExpression(out.sum, 0b111, [out.implicit, out.explicitParent, I_ADD]);
    w.endContainer();
    w.componentIdOverride = 3;
    w.startBox(0, 0, size(100, 50));
        lookup("noBundle", -1, 15, 123);
        lookup("noComponent", 777, 15, 456);
    w.endContainer();
    w.componentIdOverride = 4;
    w.startCanvas([...size(100, 50), modPropertyBundle(12, 0, [30], [v88])], 7);
        lookup("canvas", -1, 30, 0);
    w.endCanvas(7);
    w.startBox(0, 0, [...size(100, 100), modClipPath(triangle), modBackground(0xFFFF0000 | 0)]);
    w.endContainer();
w.endContainer();
w.containerEnd();   // root
const bytes = w.encodeToByteArray();
if (process.env.WRITE_FIXTURE) (await import("node:fs")).writeFileSync(process.env.WRITE_FIXTURE, bytes);

const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(W); doc.setHeight(H);
const canvas = createCanvas(W, H);
const g = canvas.getContext("2d");
const clip = g.clip.bind(g);
g.clip = (p, ...rest) => {
    if (!(p instanceof globalThis.Path2D)) return clip(p, ...rest);
    g.beginPath();
    for (const [m, a] of p.cmds) g[m](...a);
    return clip(...rest);
};
const paint = new CanvasPaintContext(null, g);
paint.createLayerCanvas = (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)).getContext("2d");
const ctx = new WebRemoteContext(paint);
ctx.mWidth = W; ctx.mHeight = H;
doc.initializeContext(ctx);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const frame = () => { g.clearRect(0, 0, W, H); doc.paint(ctx, -1); };
frame();

const values = () => Object.fromEntries(Object.entries(out).map(([k, id]) => [k, ctx.getInteger(id)]));
assert.deepEqual(values(), { implicit: 40, missingProperty: -99, explicitParent: 7, sum: 47, noBundle: 123, noComponent: 456, canvas: 88 });

// The property's variable changes: the lookup follows, and the sum with it.
ctx.overrideInteger(v40, 30);
frame();
assert.equal(ctx.getInteger(out.implicit), 30, "the lookup listens to its property's variable");
assert.equal(ctx.getInteger(out.sum), 37);

// The clip: the last box is the column's fourth child, at y = 50 + 50 + 50.
const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
const top = 150;
assert.deepEqual(px(10, top + 10), [255, 0, 0, 255], "inside the triangle: the background");
assert.deepEqual(px(80, top + 10), [255, 0, 0, 255], "inside the triangle, near its long edge");
assert.equal(px(80, top + 80)[3], 0, "below the diagonal: clipped");
assert.equal(px(40, top + 90)[3], 0, "below the diagonal: clipped");

// Raw bitmaps (RemoteBitmapDecoder): RAW8888 is ARGB, a byte each, big endian (bytes over 0x7F
// are where Java's sign extension broke it); RAW8 is opaque grey.
paint.loadBitmap(901, 0, 3, 2, 1, Uint8Array.from([0xFF, 0xC8, 0x10, 0x80, 0x80, 0x00, 0xFF, 0x00]));
paint.loadBitmap(902, 0, 2, 2, 1, Uint8Array.from([0x00, 0xF0]));
const pixels = (id) => {
    const img = paint.bitmapCache.get(id);
    assert.ok(img, `bitmap ${id} decoded`);
    const c = createCanvas(2, 1).getContext("2d");
    c.drawImage(img, 0, 0);
    return Array.from(c.getImageData(0, 0, 2, 1).data);
};
const raw8888 = pixels(901);
assert.deepEqual(raw8888.slice(0, 4), [0xC8, 0x10, 0x80, 0xFF], "opaque ARGB pixel");
assert.equal(raw8888[7], 0x80, "half-transparent pixel keeps its alpha");
assert.deepEqual(pixels(902), [0, 0, 0, 255, 0xF0, 0xF0, 0xF0, 255]);

console.log("property_bundle_test: ok");

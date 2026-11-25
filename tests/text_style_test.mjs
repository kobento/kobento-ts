// A text that names a TextStyle (textStyleId) takes from it every value it leaves at its default,
// and a style takes what it leaves unset from its parent style, as Java's CoreText.applyStyle /
// TextStyle.apply. The player read the TEXT_STYLE operation but never applied it: the CoreText
// textStyleId was a TODO, so a styled text drew at the default size and colour, plain.
//
// The styles come from json2rc's resources.textStyles; the C++ player's text_style_test plays
// the same bytes (WRITE_FIXTURE=<kobento-libs>/tests/fixtures/text_style.rc writes them).
//
//   node tests/text_style_test.mjs   (after building build-node/node-entry.js)

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

const RED = 0xFFFF0000 | 0, BLUE = 0xFF0000FF | 0;
const W = 300, H = 200;
const doc2 = Buffer.from(convert({
    header: { width: W, height: H, profiles: 513 },
    resources: { textStyles: {
        title: { color: "#FF0000", fontSize: 30, strikethrough: true },
        sub: { parent: "title", underline: true } } },
    root: { column: { modifiers: ["fillMaxSize"], children: [
        { text: { value: "Parent", textStyle: "title" } },
        { text: { value: "Child", textStyle: "sub" } },
        { text: { value: "Own colour", textStyle: "title", color: "#0000FF", fontSize: 12 } },
        { text: { value: "No style", fontSize: 12 } }] } },
}));
if (process.env.WRITE_FIXTURE) (await import("node:fs")).writeFileSync(process.env.WRITE_FIXTURE, doc2);

const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(doc2.buffer.slice(doc2.byteOffset, doc2.byteOffset + doc2.byteLength)));
doc.setWidth(W); doc.setHeight(H);
const g = createCanvas(W, H).getContext("2d");
const paint = new CanvasPaintContext(null, g);
const ctx = new WebRemoteContext(paint);
ctx.mWidth = W; ctx.mHeight = H;
doc.initializeContext(ctx); ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
for (let i = 0; i < 3; i++) doc.paint(ctx, -1);

const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
const [parent, child, own, none] = kids(kids(doc.getRootLayoutComponent())[0]);
const look = (t) => ({ size: t.mFontSizeValue, color: t.mColorValue, strike: t.mStrikethrough, under: t.mUnderline, h: t.mHeight });

assert.deepEqual({ ...look(parent), h: 0 }, { size: 30, color: RED, strike: true, under: false, h: 0 }, "the style's size, colour and strikethrough");
assert.deepEqual({ ...look(child), h: 0 }, { size: 30, color: RED, strike: true, under: true, h: 0 }, "its own underline, the rest from its parent");
assert.deepEqual({ ...look(own), h: 0 }, { size: 12, color: BLUE, strike: true, under: false, h: 0 }, "the text's own size and colour win");
assert.deepEqual({ ...look(none), h: 0 }, { size: 12, color: 0xFF000000 | 0, strike: false, under: false, h: 0 }, "an unstyled text is untouched");
assert.ok(parent.mHeight > own.mHeight * 2, `the styled text is laid out at the style's size (${parent.mHeight} vs ${own.mHeight})`);
console.log("text_style_test: ok");

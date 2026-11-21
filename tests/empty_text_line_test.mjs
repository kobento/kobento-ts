// An empty string is one empty line, also when the text takes the complex layout (an ellipsis,
// maxLines): CanvasPaintContext.layoutComplexText returned null for "" and the text measured 0
// high, so an empty chat composer (INT-13: maxLines 5, ellipsis) collapsed and its hint was
// drawn below the middle of the field. StaticLayout gives "" one line.
//
//   node tests/empty_text_line_test.mjs   (after building build-node/node-entry.js)

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

const text = (value, extra) => ({ text: { value, fontSize: 15, ...extra } });
const bytes = convert({
    header: { width: 300, height: 200, profiles: 513 },
    root: { column: { modifiers: ["fillMaxSize"], children: [
        text("", {}),                                        // simple layout
        text("", { maxLines: 5, overflow: "ellipsis" }),     // complex layout
        text("Hi", { maxLines: 5, overflow: "ellipsis" })] } },
});
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(300); doc.setHeight(200);
const g = createCanvas(300, 200).getContext("2d");
const paint = new CanvasPaintContext(null, g);
const ctx = new WebRemoteContext(paint);
ctx.mWidth = 300; ctx.mHeight = 200;
doc.initializeContext(ctx); ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
for (let i = 0; i < 3; i++) doc.paint(ctx, -1);

const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
const [plain, complex, hi] = kids(kids(doc.getRootLayoutComponent())[0]);
assert.ok(plain.mHeight > 10, `an empty text is a line high (${plain.mHeight})`);
assert.ok(complex.mHeight > 10, `an empty text with an ellipsis is a line high too (${complex.mHeight})`);
assert.ok(Math.abs(complex.mHeight - hi.mHeight) < 0.5, `as high as one line of text (${complex.mHeight} vs ${hi.mHeight})`);
console.log("empty_text_line_test: ok");

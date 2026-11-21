// A declared variable is set once, by the data pass: the paint loop does not re-apply its
// FloatConstant each frame (Java applies an operation there only when it is dirty or paints).
// Re-applying it put the initial value back over what a touch had written, so whatever read a
// scroll position before the scroll painted (here a lookup in a canvas above the row, and a
// box whose height follows the position) saw 0 after every swipe.
//
//   node tests/scroll_position_constant_test.mjs   (after building build-node/node-entry.js)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { createCanvas } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const { convertWithSymbols } = createRequire(import.meta.url)(path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build", "Parser.js"));

const W = 300, H = 300;
const pages = ["one", "two", "three", "four"];
const json = {
    header: { width: W, height: H },
    resources: { variables: { pos: 0 } },
    root: { column: { modifiers: ["fillMaxSize"], children: [
        { canvas: { modifiers: [{ size: 1 }], commands: [
            { addDataList: { id: "names", list: pages } },
            { textLookup: { array: "@names", index: "round(@pos / 300)", varName: "name" } }] } },
        { box: { modifiers: ["fillMaxWidth", { height: "max(10, 60 - @pos / 10)" }] } },
        { row: { modifiers: ["fillMaxWidth", { verticalWeight: 1 }, { horizontalScroll: { position: "@pos", notches: 4 } }],
            children: pages.map(() => ({ box: { modifiers: [{ width: 300 }, "fillMaxHeight"] } })) } }] } },
};
const { bytes, symbols } = convertWithSymbols(json);
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(W); doc.setHeight(H);
const g = createCanvas(W, H).getContext("2d");
const paint = new CanvasPaintContext(null, g);
const ctx = new WebRemoteContext(paint);
ctx.mWidth = W; ctx.mHeight = H;
doc.initializeContext(ctx);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);

// Drive the player's clocks (performance.now for the animation time, Date.now for the
// layout's size animations), so the release and the resize run to their end.
let t = 0;
const T0 = Date.now();
performance.now = () => t * 1000;
Date.now = () => T0 + t * 1000;
const frame = () => { t += 1 / 60; doc.paint(ctx, -1); };
for (let i = 0; i < 3; i++) frame();

// Swipe left by about two pages, slowly, and let it settle on a notch.
doc.touchDown(ctx, 290, 150); frame();
for (let s = 1; s <= 30; s++) { doc.touchDrag(ctx, 290 - 17 * s, 150); frame(); }
doc.touchUp(ctx, 290 - 17 * 30, 150, 0, 0);
for (let i = 0; i < 200; i++) frame();

const pos = ctx.getFloat(symbols.variables.pos);
assert.equal(pos, 600, `settled on the third page (pos ${pos})`);
const texts = [...Array(400).keys()].map((i) => ctx.getText(i)).filter((x) => pages.includes(x));
assert.equal(texts.at(-1), "three", `the lookup above the row follows the scroll (${texts})`);
// root > column > [canvas, box, row] (the root keeps its children in mChildren)
const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
const box = kids(kids(doc.getRootLayoutComponent())[0])[1];
assert.equal(box.getHeight(), 10, `the height bound to the position followed it (${box.getHeight()})`);
console.log("scroll_position_constant_test: ok");

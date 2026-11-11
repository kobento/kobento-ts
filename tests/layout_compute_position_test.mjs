// A computePosition block whose expressions change re-lays out its component, even when nothing
// else about the layout changes.
//
// Java's LayoutComputeOperation.evaluateInLayout runs the block before each measure and
// invalidates the component when an expression in it changed. The web player had no
// evaluateInLayout on it, so a position bound to a variable a click (or a drag) changes kept its
// first place unless a size changed as well, and a tap still landed there.
//
//   node tests/layout_compute_position_test.mjs   (after building build-node/node-entry.js and json2rc)

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
const { convert } = createRequire(import.meta.url)(path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build", "Parser.js"));

const W = 400, H = 300;
// A box at (200 + 50 zs, 50 - 10 zs), 80 x 40; tapping it moves zs by -3: to (50, 80).
const DOC = { header: { apiLevel: 7, width: W, height: H, profiles: 513 },
    resources: { variables: { zs: 0 } },
    root: [{ box: { modifiers: ["fillMaxSize"], children: [
        { box: { children: [], modifiers: [
            { computePosition: { x: "200 + @zs * 50", y: "50 - @zs * 10" } }, { width: 80 }, { height: 40 },
            { onClick: [{ type: "hostNamedAction", name: "tap", value: "box" },
                        { type: "valueFloatExpressionChange", target: "@zs", value: "@zs - 3" }] }] } },
    ] } }] };
const bytes = convert(DOC);

const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(W); doc.setHeight(H);
const paint = new CanvasPaintContext(null, createCanvas(W, H).getContext("2d"));
const ctx = new WebRemoteContext(paint);
ctx.mWidth = W; ctx.mHeight = H;
doc.initializeContext(ctx);
ctx.setAnimationEnabled(false);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const frames = () => { for (let i = 0; i < 4; i++) doc.paint(ctx, -1); };
const taps = [];
doc.addActionCallback({ onAction: (name) => taps.push(name) });
const tap = (x, y) => { taps.length = 0; doc.onClick(ctx, x, y); frames(); return taps.length; };

frames();
assert.equal(tap(240, 70), 1, "the box is first at (200, 50)");
assert.equal(tap(240, 70), 0, "after the tap it has moved away");
assert.equal(tap(90, 100), 1, "to (50, 80)");
console.log("ok");

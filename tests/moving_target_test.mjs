// A layout animation whose target changes every frame (a spacer following a drag, a live
// resize) runs out its time instead of restarting at 0 on each change. The reference keeps the
// start time in AnimateMeasure.updateTarget; this player reset it, so INT-14's dragged row
// stayed at its origin, nearly transparent, for as long as the finger moved.
//
//   node tests/moving_target_test.mjs   (after building build-node/node-entry.js and build-json2rc)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { createCanvas } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext, createHostApi } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const { convert } = createRequire(import.meta.url)(path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build", "Parser.js"));

const DOC = { header: { apiLevel: 7, width: 200, height: 400, profiles: 513 },
    resources: { variables: { h: { value: 0, export: true } } },
    root: { column: { modifiers: ["fillMaxSize"], children: [
        { box: { modifiers: [{ height: "@h" }] } },
        { box: { modifiers: [{ size: [100, 40] }, { background: "#ff0000" }] } }] } } };
const bytes = convert(DOC);

let now = 1_000_000;
const clock = { millis: () => now, snapshot: () => null };
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(200); doc.setHeight(400);
const paint = new CanvasPaintContext(null, createCanvas(200, 400).getContext("2d"));
const ctx = new WebRemoteContext(paint);
ctx.mWidth = 200; ctx.mHeight = 400;
doc.initializeContext(ctx); ctx.setClock(clock);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const frame = () => { doc.paint(ctx, -1); now += 16; };
const host = createHostApi({ getDocument: () => doc, getRemoteContext: () => ctx, repaint: () => doc.paint(ctx, -1) });
for (let i = 0; i < 5; i++) frame();

const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
let red = null;
const walk = (c) => { for (const k of kids(c)) { if (k.getWidth() === 100 && k.getHeight() === 40) red = k; walk(k); } };
walk(doc.getRootLayoutComponent());
assert.ok(red, "the moving box");

// 3 px further every frame for 40 frames (640 ms, past the 300 ms default animation).
const ys = [];
for (let i = 1; i <= 40; i++) { host.set("h", i * 3); frame(); ys.push(red.getY()); }
// (As in the reference, each animation ends after its time and the next change starts a new
// one, whose eased start holds still for a few frames: the box trails the target by a little,
// not by everything.)
const target = 120;
assert.ok(ys[39] >= target - 12, `the box follows a target that moves every frame (ends at ${ys[39].toFixed(1)}, target ${target}; y: ${ys.map((y) => y.toFixed(0)).join(" ")})`);
console.log("moving_target_test: ok");
process.exit(0);

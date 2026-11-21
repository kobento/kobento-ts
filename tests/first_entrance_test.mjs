// A component that has only ever been GONE enters at its own bounds (a fade), not from the
// placeholder position it was laid out at while gone (its parent's origin). NavShell's title
// (one text per destination in a box, each shown by a visibility modifier) slid down from the
// top the first time a destination was selected, and only faded in after that.
//
//   node tests/first_entrance_test.mjs   (after building build-node/node-entry.js and build-json2rc)

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

const title = (i, text) => ({ text: { value: text, fontSize: 22, modifiers: [{ visibility: `1 - min(1, abs(@tab - ${i}))` }] } });
const DOC = { header: { apiLevel: 7, width: 200, height: 100, profiles: 513 },
    resources: { variables: { tab: { value: 0, export: true } } },
    root: { box: { verticalAlignment: "center", modifiers: ["fillMaxWidth", { height: 56 }, { padding: [16, 0] }], children: [title(0, "Home"), title(1, "Discover")] } } };
const bytes = convert(DOC);

let now = 1_000_000;
const clock = { millis: () => now, snapshot: () => null };
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(200); doc.setHeight(100);
const paint = new CanvasPaintContext(null, createCanvas(200, 100).getContext("2d"));
const ctx = new WebRemoteContext(paint);
ctx.mWidth = 200; ctx.mHeight = 100;
doc.initializeContext(ctx); ctx.setClock(clock);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const frame = () => { doc.paint(ctx, -1); now += 16; };
const host = createHostApi({ getDocument: () => doc, getRemoteContext: () => ctx, repaint: () => doc.paint(ctx, -1) });
for (let i = 0; i < 5; i++) frame();

const texts = [];
// (The root keeps its children in mChildren, the layouts in mChildrenComponents.)
const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
const walk = (c) => { for (const k of kids(c)) { if (k.constructor.name.includes("Text")) texts.push(k); walk(k); } };
walk(doc.getRootLayoutComponent());
assert.equal(texts.length, 2, "two titles");
const shown = texts[0].getY();
assert.ok(shown > 0, "the shown title is centred in the bar, below its top");

const entrance = (tab, t) => {
    host.set("tab", tab);
    const ys = [];
    for (let f = 0; f < 30; f++) { frame(); ys.push(t.getY()); }
    return ys;
};
const first = entrance(1, texts[1]);
assert.ok(texts[1].mAnimateMeasure !== null || first.length, "it animates (a fade)");
for (const y of first) assert.equal(y, shown, `the first entrance stays at y=${shown} (was sliding from 0): ${first.join(", ")}`);
entrance(0, texts[0]);
for (const y of entrance(1, texts[1])) assert.equal(y, shown, "later entrances stay in place too");
console.log("first_entrance_test: ok");
process.exit(0);

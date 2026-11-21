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

// A panel shown by a visibility modifier holds a list. While the panel is GONE its children are
// still laid out, at placeholder bounds (the width a GONE layout gives them); when the panel
// appears, the list must appear at its real size, not grow from that sliver (CMP-49's tabs).
const panel = (i, label) => ({ column: { modifiers: [{ visibility: `1 - min(1, abs(@tab - ${i}))` }, "fillMaxWidth", { padding: 12 }],
    children: [{ column: { modifiers: ["fillMaxWidth", { height: 60 }], children: [{ text: { value: label, fontSize: 16 } }] } }] } });
const DOC = { header: { apiLevel: 7, width: 300, height: 120, profiles: 513 },
    resources: { variables: { tab: { value: 0, export: true } } },
    root: { row: { modifiers: ["fillMaxSize"], children: [panel(0, "First"), panel(1, "Second")] } } };
const bytes = convert(DOC);

let now = 1_000_000;
const clock = { millis: () => now, snapshot: () => null };
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(300); doc.setHeight(120);
const paint = new CanvasPaintContext(null, createCanvas(300, 120).getContext("2d"));
const ctx = new WebRemoteContext(paint);
ctx.mWidth = 300; ctx.mHeight = 120;
doc.initializeContext(ctx); ctx.setClock(clock);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const frame = () => { doc.paint(ctx, -1); now += 16; };
const host = createHostApi({ getDocument: () => doc, getRemoteContext: () => ctx, repaint: () => doc.paint(ctx, -1) });
for (let i = 0; i < 5; i++) frame();

const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
const lists = [];
const walk = (c) => { for (const k of kids(c)) { if (/Column/.test(k.constructor.name) && k.getHeight() === 60) lists.push(k); walk(k); } };
walk(doc.getRootLayoutComponent());
assert.equal(lists.length, 2, "two lists, one per panel");
const full = lists[0].getWidth();
assert.ok(full > 200, `the shown list fills its panel (${full})`);

const entrance = (tab, list) => {
    host.set("tab", tab);
    const ws = [];
    for (let f = 0; f < 30; f++) { frame(); ws.push(list.getWidth()); }
    return ws;
};
for (const w of entrance(1, lists[1])) assert.equal(w, full, `the second list appears at full width: ${w}`);
for (const w of entrance(0, lists[0])) assert.equal(w, full, "and the first one when it comes back");
console.log("gone_parent_entrance_test: ok");
process.exit(0);

// The Navigator convention against the real player core, headless: the app's back
// (createHostApi canGoBack / back) over a stack the app puts back, and the start's back arrow
// (the host action "back"). The document is kobento-mcp's Navigator demo (rooms > a room's
// plants > a plant > a sheet); its taps and transitions are tested there, through the inspector.
//
//   node tests/navigator_back_test.mjs      (after building build-node/node-entry.js)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { createCanvas } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext, createHostApi } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const MCP = process.env.KOBENTO_MCP ?? path.join(root, "..", "kobento-mcp");
const bytes = readFileSync(path.join(MCP, "examples", "components", "Navigator", "doc.rc"));
const W = 360, H = 640;

function player() {
    let doc = null, ctx = null, now = 1_000_000;
    const clock = { millis: () => now, snapshot: () => null };
    const p = {
        getDocument: () => doc,
        getRemoteContext: () => ctx,
        repaint: () => { if (doc) doc.paint(ctx, -1); },
        // Frames for half a second: a push or a pop (0.3 s) settles.
        // (the web player sets the animation time each frame, as here)
        settle: () => { for (let i = 0; i < 32; i++) { ctx.setAnimationTime((now - 1_000_000) / 1000); doc.paint(ctx, -1); now += 16; } },
        click: (x, y) => { doc.onClick(ctx, x, y); p.settle(); },
    };
    doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    doc.setWidth(W); doc.setHeight(H);
    const c = createCanvas(W, H);
    const paint = new CanvasPaintContext(null, c.getContext("2d"));
    ctx = new WebRemoteContext(paint);
    ctx.mWidth = W; ctx.mHeight = H;
    doc.initializeContext(ctx); ctx.setClock(clock);
    ctx.setPaintContext(paint); paint.setContext(ctx);
    doc.applyDataOperations(ctx);
    p.settle();
    return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = player();
const host = createHostApi(p);
await sleep(60);
const sent = [];
host.onAction("*", (value, name) => sent.push([name, value]));

const vars = host.variables();
for (const v of ["canGoBack", "backCount", "navStack", "navDepth", "navBase"]) assert.equal(vars[v], "float", `${v} is exported`);

// At the start: the document cannot go back; the system back is the app's.
assert.equal(host.canGoBack(), false);
assert.equal(host.back(), false);
assert.equal(host.get("backCount"), 0);
// Its own back arrow asks the app to go back.
p.click(28, 28);
assert.equal(sent.pop()?.[0], "back");

// A stack the app saved and puts back: rooms > a room's plants > a plant (base 5 digits).
assert.equal(host.set("navStack", (1 * 5 + 2) * 5 + 3), true);
assert.equal(host.set("navDepth", 3), true);
p.settle();
assert.equal(host.canGoBack(), true);
// Each system back is the document's while it can go back: backCount counts them.
assert.equal(host.back(), true);
p.settle();
assert.equal(host.get("backCount"), 1);
assert.equal(host.canGoBack(), true);
assert.equal(host.back(), true);
p.settle();
assert.equal(host.get("backCount"), 2);
assert.equal(host.canGoBack(), false, "back at the start");
assert.equal(host.back(), false);
assert.equal(host.get("backCount"), 2, "the app's back leaves the count alone");

host.dispose();
console.log("navigator_back_test: ok");

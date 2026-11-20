// A component's graphicsLayer (translation, scale, alpha...) applies while a layout animation
// paints it (a visibility fade), as in the reference, where AnimateMeasure paints through
// paintingComponent, which opens the layer. This player opened it in paint() only, so a
// screen sliding in with translationX while it faded in was drawn in place, see-through, on
// top of the screen it was covering (CMP-76's navigation stack).
//
//   node tests/layer_during_fade_test.mjs   (after building build-node/node-entry.js and build-json2rc)

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

// A 100 x 100 red box shown by `on`, moved 50 to the right by its graphicsLayer. (The fade
// composites through a layer bounded by the component's own box, as Android's saveLayer does,
// so only the part of the moved box inside its untranslated bounds shows while it fades.)
const DOC = { header: { apiLevel: 7, width: 200, height: 100, profiles: 513 },
    resources: { variables: { on: { value: 0, export: true } } },
    root: { box: { modifiers: ["fillMaxSize"], children: [
        { box: { modifiers: [{ visibility: "@on" }, { size: [100, 100] }, { graphicsLayer: { translationX: 50 } }, { background: "#ff0000" }] } }] } } };
const bytes = convert(DOC);

let now = 1_000_000;
const clock = { millis: () => now, snapshot: () => null };
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(200); doc.setHeight(100);
const canvas = createCanvas(200, 100), g = canvas.getContext("2d");
const paint = new CanvasPaintContext(null, g);
// (Node has no OffscreenCanvas: the layers are node-canvas ones.)
paint.createLayerCanvas = (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)).getContext("2d");
const ctx = new WebRemoteContext(paint);
ctx.mWidth = 200; ctx.mHeight = 100;
doc.initializeContext(ctx); ctx.setClock(clock);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const frame = () => { g.clearRect(0, 0, 200, 100); doc.paint(ctx, -1); now += 16; };
const host = createHostApi({ getDocument: () => doc, getRemoteContext: () => ctx, repaint: () => doc.paint(ctx, -1) });
for (let i = 0; i < 5; i++) frame();

const redAt = (x, y) => { const [r, , , a] = g.getImageData(x, y, 1, 1).data; return a > 0 && r > 0 ? a : 0; };
host.set("on", 1);
let fading = 0;
for (let f = 0; f < 30; f++) {
    frame();
    const left = redAt(25, 50), right = redAt(75, 50);
    if (right > 0 && right < 255) fading++;
    assert.equal(left, 0, `frame ${f}: nothing where the box is before its translation (alpha ${left})`);
}
assert.ok(fading > 0, "the fade-in was seen, at the translated place");
assert.equal(redAt(125, 50), 255, "the box ends solid, 50 to the right");
assert.equal(redAt(25, 50), 0, "and not where it was before its translation");
console.log("layer_during_fade_test: ok");
process.exit(0);

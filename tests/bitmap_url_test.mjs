// A bitmap with ENCODING_URL (json2rc's resources.bitmaps {"url": ...}, the bytes of
// RemoteComposeBuffer.storeBitmapUrl) is fetched once, decoded, resampled to its declared size
// and drawn; nothing is drawn before it arrives, and onBitmapLoaded tells the player to paint
// again. A 1x1 declaration takes the picture's own size.
//
//   node tests/bitmap_url_test.mjs   (after building build-node/node-entry.js and build-json2rc)

import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { createCanvas, loadImage } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const { convert } = createRequire(import.meta.url)(path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build", "Parser.js"));

// A 40x20 PNG: left half red, right half blue.
const src = createCanvas(40, 20), sctx = src.getContext("2d");
sctx.fillStyle = "#ff0000"; sctx.fillRect(0, 0, 20, 20);
sctx.fillStyle = "#0000ff"; sctx.fillRect(20, 0, 20, 20);
const png = src.toBuffer("image/png");
let requests = 0;
const server = http.createServer((req, res) => {
    requests++;
    if (req.url === "/pic.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(png); }
    else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

async function run(bitmap, srcRect) {
    const DOC = { header: { apiLevel: 7, width: 100, height: 50, profiles: 513 },
        resources: { bitmaps: { photo: bitmap } },
        root: { canvas: { modifiers: ["fillMaxSize"], commands: [
            { type: "drawScaledBitmap", image: "@photo", srcLeft: 0, srcTop: 0, srcRight: srcRect[0], srcBottom: srcRect[1],
              dstLeft: 0, dstTop: 0, dstRight: 100, dstBottom: 50, scaleType: 6 }] } } };
    const bytes = convert(DOC);
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    doc.setWidth(100); doc.setHeight(50);
    const canvas = createCanvas(100, 50);
    const paint = new CanvasPaintContext(null, canvas.getContext("2d"));
    paint.createLayerCanvas = (w, h) => createCanvas(w, h).getContext("2d");
    paint.decodeImage = (b) => loadImage(Buffer.from(b));
    let loaded = 0;
    paint.onBitmapLoaded = () => loaded++;
    const ctx = new WebRemoteContext(paint);
    ctx.mWidth = 100; ctx.mHeight = 50;
    doc.initializeContext(ctx);
    ctx.setPaintContext(paint); paint.setContext(ctx);
    doc.applyDataOperations(ctx);
    const pixel = (x, y) => [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
    doc.paint(ctx, -1);
    assert.equal(pixel(10, 25)[3], 0, "nothing is drawn before the picture arrives");
    for (let i = 0; i < 200 && !loaded; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(loaded, 1, "onBitmapLoaded runs once the picture is decoded");
    canvas.getContext("2d").clearRect(0, 0, 100, 50);
    doc.paint(ctx, -1);
    return { pixel, ctx, doc };
}

// Declared 40x20, as the picture is: the left half red, the right half blue.
let r = await run({ url: `${base}/pic.png`, width: 40, height: 20 }, [40, 20]);
assert.deepEqual(r.pixel(25, 25), [255, 0, 0, 255]);
assert.deepEqual(r.pixel(75, 25), [0, 0, 255, 255]);
// Declared 80x40 (a different resolution than served): the source rect is in declared pixels,
// so 0..80 is still the whole picture.
r = await run({ url: `${base}/pic.png`, width: 80, height: 40 }, [80, 40]);
assert.deepEqual(r.pixel(25, 25), [255, 0, 0, 255]);
assert.deepEqual(r.pixel(75, 25), [0, 0, 255, 255]);
// Declared 1x1 (size unknown): the BitmapData takes the picture's own 40x20.
r = await run({ url: `${base}/pic.png` }, [40, 20]);
assert.deepEqual(r.pixel(75, 25), [0, 0, 255, 255]);
const data = [...r.doc.getOperations()].find((o) => o && "mImageId" in o && typeof o.setSize === "function");
assert.equal(data.getWidth(), 40); assert.equal(data.getHeight(), 20);
// Fetched once per document, not once per paint.
assert.equal(requests, 3);
server.close();
console.log("bitmap_url_test: ok");

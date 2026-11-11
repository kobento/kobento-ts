// A row partly in a scrolling column's view is painted (and clipped), whatever the padding.
//
// The web player skips painting a scroll container's children that are out of view (the
// reference paints them all and lets the clip cut them). It took the view as the height less
// every padding, but a padding after the scroll modifier belongs to the scrolled content (room
// at the end of a list, under a floating button): rows in the bottom of the view were skipped
// whole, a gap where a partly visible row belonged (kobento-mcp CMP-63).
//
//   node tests/scroll_partial_rows_test.mjs   (after building build-node/node-entry.js and json2rc)

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

const W = 200, H = 200;
// Rows 60 high: the fourth starts at 180, so its top 20 px are in the 200 px view; the column
// keeps 88 px of padding after its scroll modifier.
const rows = ["#FFFF0000", "#FF00FF00", "#FF0000FF", "#FFFF00FF", "#FF00FFFF"].map((c) =>
    ({ box: { modifiers: ["fillMaxWidth", { height: 60 }, { background: c }] } }));
const DOC = { header: { apiLevel: 7, width: W, height: H, profiles: 513 },
    resources: { variables: { scroll: 0 } },
    root: [{ column: { modifiers: ["fillMaxSize", { background: "#FFFFFFFF" }, { verticalScroll: "@scroll" }, { padding: { bottom: 88 } }], children: rows } }] };
const bytes = convert(DOC);

const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(W); doc.setHeight(H);
const canvas = createCanvas(W, H);
const paint = new CanvasPaintContext(null, canvas.getContext("2d"));
const ctx = new WebRemoteContext(paint);
ctx.mWidth = W; ctx.mHeight = H;
doc.initializeContext(ctx);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
for (let i = 0; i < 3; i++) doc.paint(ctx, -1);

const px = (x, y) => [...canvas.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
assert.deepEqual(px(100, 150), [0, 0, 255], "the third row, whole in view");
assert.deepEqual(px(100, 190), [255, 0, 255], "the fourth row, partly in view, is painted");
console.log("ok");

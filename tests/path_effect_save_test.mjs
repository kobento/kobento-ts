// The dash path effect is part of the paint, which a matrix save/restore does not touch.
//
// On Android canvas.save() / restore() keep the matrix and clip; the Paint is separate. The web
// player kept the dash on the 2D context instead, and ctx.save() / restore() hold the line
// dash, so a dash set before a matrixSave came back at its matrixRestore and one set inside was
// lost: an edge's dashed stroke leaked into everything drawn after a marker drawn in a save.
//
//   node tests/path_effect_save_test.mjs   (after building build-node/node-entry.js and json2rc)

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

const W = 200, H = 60;
const dash = (v) => ({ paint: { ops: [{ pathEffect: v }] } });
const line = (y) => ({ drawLine: { x1: 10, y1: y, x2: 190, y2: y } });
const DOC = { header: { apiLevel: 7, width: W, height: H, profiles: 513 },
    root: [{ canvas: { modifiers: ["fillMaxSize", { background: "#FF000000" }], commands: [
        { paint: { ops: [{ color: "#FFFFFFFF" }, { style: "stroke" }, { width: 2 }] } },
        // Dashed, then cleared inside a save: still clear after the restore.
        dash([6, 6]),
        { save: { commands: [dash(null)] } },
        line(15),
        // Clear, then dashed inside a save: still dashed after the restore.
        dash(null),
        { save: { commands: [dash([6, 6])] } },
        line(45),
    ] } }] };
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
doc.paint(ctx, -1);

// The share of the row, over the line's length, that is lit: about 1 solid, about 0.5 dashed.
const px = canvas.getContext("2d").getImageData(0, 0, W, H).data;
const lit = (y) => {
    let n = 0;
    for (let x = 14; x < 186; x++) if (px[(y * W + x) * 4] > 128) n++;
    return n / (186 - 14);
};
const solid = lit(15), dashed = lit(45);
console.log(`line cleared inside a save: ${(solid * 100).toFixed(0)}% lit; dashed inside a save: ${(dashed * 100).toFixed(0)}% lit`);
assert.ok(solid > 0.95, "a dash cleared inside a save stays cleared after the restore");
assert.ok(dashed > 0.3 && dashed < 0.7, "a dash set inside a save stays set after the restore");
console.log("ok");

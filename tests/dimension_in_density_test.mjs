// widthIn / heightIn bounds scale by the density (authored in dp, as the reference's
// DimensionInModifierOperation), once: a literal bound was scaled in place, so it grew by the
// density on every update (a heightIn(48) row was 96, then 192 at density 2). The reference
// computes it from the written value each time.
//
//   node tests/dimension_in_density_test.mjs   (after building build-node/node-entry.js)

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

const DOC = { header: { apiLevel: 7, width: 400, height: 400, profiles: 513 },
    root: { column: { children: [
        { row: { modifiers: [{ heightIn: [48, 400] }, { widthIn: [30, 120] }], children: [{ box: { modifiers: [{ size: 4 }] } }] } },
    ] } } };
const bytes = convert(DOC);

function rowSize(density, frames) {
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    doc.setWidth(400); doc.setHeight(400);
    const paint = new CanvasPaintContext(null, createCanvas(400, 400).getContext("2d"));
    const ctx = new WebRemoteContext(paint);
    ctx.mWidth = 400; ctx.mHeight = 400;
    ctx.setDensity(density);
    doc.initializeContext(ctx);
    ctx.setPaintContext(paint); paint.setContext(ctx);
    doc.applyDataOperations(ctx);
    let now = 1_000_000;
    ctx.setClock({ millis: () => now, snapshot: () => null });
    for (let i = 0; i < frames; i++) {
        // Each frame re-reads the variables, as a changed value or the density would make it.
        doc.getRootLayoutComponent().invalidateMeasure?.();
        doc.updateVariables?.(ctx);
        doc.paint(ctx, -1); now += 16;
    }
    let row = null;
    const kids = (c) => c.mChildrenComponents ?? (c.mChildren ?? []).filter((x) => typeof x.getComponentId === "function");
    const walk = (c) => { for (const k of kids(c)) { if (!row && /^_?RowLayout$/.test(k.constructor.name)) row = k; walk(k); } };
    walk(doc.getRootLayoutComponent());
    // Updated again (a variable or the density changed, a re-measure): still scaled once.
    for (const m of [row.getWidthInModifier?.() ?? row.mWidthInMod, row.getHeightInModifier()]) { m.updateVariables(ctx); m.updateVariables(ctx); }
    return [row.getWidth(), row.getHeight(), row.mWidthInMod.getMin(), row.getHeightInModifier().getMin()];
}

assert.deepEqual(rowSize(1, 1), [30, 48, 30, 48], "density 1: the minimums");
for (const frames of [1, 5]) assert.deepEqual(rowSize(2, frames), [60, 96, 60, 96], `density 2 after ${frames} frames: scaled once`);
console.log("dimension_in_density_test: ok");
process.exit(0);

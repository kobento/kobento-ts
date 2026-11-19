// valueStringChange writes any string into its target, the empty one included: a search bar's
// clear button sets the query to "" (WebRemoteContext.overrideText skipped "" before).
//
//   node tests/value_string_change_test.mjs   (after building build-node/node-entry.js and build-json2rc)

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

const tap = (value) => ({ box: { modifiers: [{ size: [200, 50] }, { onClick: { type: "valueStringChange", target: "@query", value } }] } });
const DOC = { header: { apiLevel: 7, width: 200, height: 100, profiles: 513 },
    resources: { variables: { query: { type: "string", value: "Porto", export: true } } },
    root: { column: { modifiers: ["fillMaxSize"], children: [tap(""), tap("Lisbon")] } } };
const bytes = convert(DOC);

const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(200); doc.setHeight(100);
const paint = new CanvasPaintContext(null, createCanvas(200, 100).getContext("2d"));
const ctx = new WebRemoteContext(paint);
ctx.mWidth = 200; ctx.mHeight = 100;
doc.initializeContext(ctx);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);
const p = { getDocument: () => doc, getRemoteContext: () => ctx, repaint: () => doc.paint(ctx, -1) };
p.repaint();
const host = createHostApi(p);

assert.equal(host.get("query"), "Porto");
doc.onClick(ctx, 100, 25); p.repaint();
assert.equal(host.get("query"), "", "a valueStringChange to \"\" clears the string");
doc.onClick(ctx, 100, 75); p.repaint();
assert.equal(host.get("query"), "Lisbon");
doc.onClick(ctx, 100, 25); p.repaint();
assert.equal(host.get("query"), "");
host.dispose();
console.log("value_string_change_test: ok");

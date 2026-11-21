// LAYOUT_TEXT_INPUT (TextInputLayout, androidx 7f6f9150bc8): a box whose content shows a string
// the user can edit. tests/fixtures/text_input.json stacks four 60-tall fields on black:
//   0 editableText "@name" (empty, hint "Your name")      a text directly in the layout
//   1 textInput "@email" { row { icon, text "@email" } }   the bound text nested in a row
//   2 a text "@city" ("Paris") with json2rc's textInput modifier (rewritten into the layout)
//   3 textInput "@code" { box } (empty, hint "Code")       no bound text: hint at the content origin,
//     in the default style (black at 45%), on a white field
//   4 textInput "@pin" { text "@pin", invisible } (empty, hint "PIN") -> the hint where the text
//     is: the layout draws it, whether the text is shown or not (Java paintHint)
// Checks: an empty string draws its hint (dimmed), a click starts a session with the right
// layout, bounds and text, setText writes the string, the bound text is not painted while the
// editor shows it, and end() paints it again.
//
//   node tests/text_input_layout_test.mjs   (after building build-node/node-entry.js and build-json2rc)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { createCanvas } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const { convert } = createRequire(import.meta.url)(path.join(process.env.KOBENTO_TOOLS ?? path.join(root, "..", "kobento-tools"), "json2rc", "build", "Parser.js"));

const W = 300, H = 300;
const bytes = convert(JSON.parse(fs.readFileSync(path.join(here, "fixtures", "text_input.json"), "utf8")));
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
doc.setWidth(W); doc.setHeight(H);
const canvas = createCanvas(W, H);
const g = canvas.getContext("2d");
const paint = new CanvasPaintContext(null, g);
const ctx = new WebRemoteContext(paint);
ctx.mWidth = W; ctx.mHeight = H;
doc.initializeContext(ctx);
ctx.setPaintContext(paint); paint.setContext(ctx);
doc.applyDataOperations(ctx);

const sessions = [];
const support = {
    startTextInput: (s) => sessions.push(s),
    updateTextInputBounds: () => {},
    stopTextInput: () => {},
};
paint.setTextInputSupport(support);

const frame = () => { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); doc.paint(ctx, -1); };
// The brightest channel sum among the lit pixels of field i (a 60-tall band), and how many.
const ink = (i, x0 = 0, x1 = W) => {
    const d = g.getImageData(0, 0, W, H).data;
    let n = 0, max = 0;
    for (let y = i * 60; y < i * 60 + 60; y++) for (let x = x0; x < x1; x++) {
        const k = (y * W + x) * 4, s = d[k] + d[k + 1] + d[k + 2];
        if (s > 60) { n++; max = Math.max(max, s); }
    }
    return { n, max };
};

frame();
const hint0 = ink(0), city = ink(2);
// Field 3 is white: its hint is the grey pixels (neither white nor black).
const grey = (() => {
    const d = g.getImageData(0, 180, W, 60).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) { const s = d[k] + d[k + 1] + d[k + 2]; if (s > 100 && s < 600) n++; }
    return n;
})();
assert.ok(hint0.n > 30, `field 0 draws its hint (${hint0.n} lit pixels)`);
assert.ok(hint0.max < 500, `the hint is dimmed (max ${hint0.max}, white text is 765)`);
assert.ok(ink(1, 60).n > 30, "field 1: the hint of a text nested in a row");
assert.ok(grey > 30, "field 3: an unbound layout draws its hint at its content origin");
assert.ok(city.n > 30 && city.max > 600, "field 2 (the modifier form) shows its text in full colour");
const pin = ink(4);
assert.ok(pin.n > 30 && pin.max < 500, "field 4: an invisible bound text still gets its hint");

// A tap on field 0 starts a session over the bound text.
assert.equal(doc.onClick(ctx, 150, 30), true, "a tap on the field is handled");
assert.equal(sessions.length, 1);
const s = sessions[0];
assert.equal(s.getLayout().getKeyboardType(), 1);
assert.equal(s.getLayout().getContentType(), 1, "contentType personName");
assert.equal(s.getLayout().getInputFlags() & 16, 16, "capitalization words");
assert.equal(s.getHint(), "Your name");
assert.ok(s.getTextComponent(), "the bound text is found");
const [bx, by, bw, bh] = s.getBounds();
assert.ok(bx >= 0 && by >= 0 && bw > 200 && bh > 0 && by + bh <= 60, `bounds cover the text inside field 0: ${s.getBounds()}`);
s.setText("Ada");
assert.equal(ctx.getText(s.getLayout().getTextId()), "Ada", "setText writes the string");
frame();
assert.equal(ink(0).n, 0, "while editing, the bound text is not painted (the editor shows it)");
s.end();
// The hidden text skipped its update while the editor was up (it is not painted, as in Java):
// its first frame back takes the new string, the next lays it out. The player paints a few
// frames after a repaint request (RcdPlayer.SETTLE_FRAMES).
frame(); frame();
assert.ok(ink(0).max > 600, "after end(), the text is painted again, in full colour");

// The nested text of field 1; the modifier form of field 2, a tap anywhere in its box.
assert.equal(doc.onClick(ctx, 10, 90), true);
assert.equal(sessions[1].getLayout().getKeyboardType(), 6, "email keyboard");
assert.equal(sessions[1].getLayout().getImeAction(), 6, "imeAction next");
assert.ok(sessions[1].getBounds()[0] > 20, "the editor starts after the icon, over the nested text");
sessions[1].end();
assert.equal(doc.onClick(ctx, 5, 150), true);
assert.equal(sessions[2].getText(), "Paris");
assert.ok(sessions[2].getTextComponent(), "the rewritten modifier form binds its text");
sessions[2].end();
// Field 3 has no bound text: the session covers the layout.
assert.equal(doc.onClick(ctx, 150, 210), true);
assert.equal(sessions[3].getTextComponent(), null);
assert.deepEqual(sessions[3].getBounds().map(Math.round), [0, 180, W, 60]);
assert.equal(sessions[3].getLayout().getFilter(), 1, "digits filter");
sessions[3].end();

// Without a support the layout is a plain box: a tap does nothing.
paint.setTextInputSupport(null);
assert.equal(doc.onClick(ctx, 150, 30), false);
assert.equal(sessions.length, 4);
console.log("text_input_layout_test: ok");

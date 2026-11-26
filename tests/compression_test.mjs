// Compressed documents (Header.COMPRESS = DEFLATE): the fixture was compressed by androidx
// remote-core's own Header.compressDocument, so this checks the player against the reference.
//
//   node tests/compression_test.mjs      (after building build-node/node-entry.js)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { decompressDocument, inflateZlib, isCompressed, RemoteComposeBuffer, CoreDocument } =
    await import(pathToFileURL(path.join(here, "..", "build-node", "node-entry.js")).href);
const fixture = (n) => new Uint8Array(readFileSync(path.join(here, "fixtures", n)));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The reference's compressed document decompresses to the original, byte for byte.
const plain = fixture("analog-clock.rc"), packed = fixture("analog-clock.deflate.rc");
assert.equal(isCompressed(packed), true);
assert.equal(isCompressed(plain), false);
assert.ok(packed.length < plain.length);
assert.ok(same(decompressDocument(packed), plain), "decompresses to the uncompressed original");
assert.equal(decompressDocument(plain), plain, "an uncompressed document is passed through");

// The same stream behind Header.COMPRESSED_STREAM_MARKER (0x77), as Header.compressDocument writes
// it since the 3D change (4256202): the marker is skipped. (The fixture predates the marker, which
// readers also take.)
const headerEnd = (b) => {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let at = 17;
    for (let i = 0, n = dv.getInt32(13); i < n; i++) at += 4 + dv.getUint16(at + 2);
    return at;
};
const end = headerEnd(packed);
assert.equal(packed[end], 0x78, "the fixture: the zlib stream right after the header");
const marked = new Uint8Array(packed.length + 1);
marked.set(packed.subarray(0, end), 0); marked[end] = 0x77; marked.set(packed.subarray(end), end + 1);
assert.ok(same(decompressDocument(marked), plain), "a stream after the marker decompresses to the original");
if (process.env.WRITE_FIXTURE) (await import("node:fs")).writeFileSync(process.env.WRITE_FIXTURE, marked);

// The player loads it: same operations as the original.
const ops = (bytes) => {
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.slice().buffer));
    return doc.getOperations().map((o) => o.constructor.name);
};
assert.deepEqual(ops(packed), ops(plain));

// Every DEFLATE block type: stored (level 0), fixed and dynamic codes, long matches.
for (const data of [new Uint8Array(0), new Uint8Array(70000).fill(3), Uint8Array.from({ length: 90000 }, (_, i) => (i * 2654435761) >>> 24), plain]) {
    for (const opts of [{ level: 0 }, { level: 1 }, { level: 9 }, { strategy: 2 }, { strategy: 4 }]) {
        assert.ok(same(inflateZlib(new Uint8Array(deflateSync(data, opts))), data), JSON.stringify(opts));
    }
}

// Damaged or unsupported documents are refused with the reference's reasons, never misread.
const bad = (f) => { const c = packed.slice(); f(c); return c; };
const at = packed.findIndex((_, j) => j > 16 && packed[j] === 0 && packed[j + 1] === 31 && packed[j + 2] === 0 && packed[j + 3] === 4);
for (const [bytes, message] of [
    [packed.slice(0, packed.length - 10), /Truncated/],
    [Uint8Array.from([...packed, 0]), /Unexpected data after/],
    [bad((c) => { c[c.length - 1] ^= 1; }), /Corrupted/],
    [bad((c) => { c[at + 7] = 2; }), /Unsupported document compression 2/],
]) assert.throws(() => decompressDocument(bytes), message);

console.log("compression_test: ok");

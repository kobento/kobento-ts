// BINARY_DATA (41) against the Java reference (same fixture as the C++ test): each operation
// as the reference writes it and what the reference reads back, or REJECT when its reader
// refuses it. Each case is read through the operation registry, as a document is, and
// applied: the blob must then be the context's object under its id.
//
// The size limit is also checked with a blob of each size, since the fixture's refused case
// has a length longer than its buffer and is refused for that reason as well.
//
//   node tests/binary_data_test.mjs [FILE.txt]      (ESBUILD=<path> to skip npx)
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ts = path.join(here, "..");
const file = process.argv[2] ?? path.join(process.env.KOBENTO_LIBS ?? path.join(here, "../../kobento-libs"), "tests/fixtures/binary_data_java.txt");
const dir = mkdtempSync(path.join(os.tmpdir(), "binary-data-"));
const out = path.join(dir, "bd.mjs");
const entry = path.join(dir, "entry.ts");
writeFileSync(entry, `export { Operations } from ${JSON.stringify(path.join(ts, "src/core/Operations.ts"))};\n`
    + `export { WireBuffer } from ${JSON.stringify(path.join(ts, "src/core/WireBuffer.ts"))};\n`);
const [cmd, ...pre] = process.env.ESBUILD ? [process.env.ESBUILD] : ["npx", "esbuild"];
execFileSync(cmd, [...pre, entry, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${out}`, "--log-level=error"], { cwd: ts, stdio: "inherit" });
const { Operations, WireBuffer } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true });

const unhex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Read one operation from `bytes` through the registry; null if the reader refused it. */
function load(bytes) {
    const buf = WireBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    const reader = Operations.getReader(buf.readByte()) ?? null;
    if (!reader) throw new Error("BINARY_DATA (41) has no reader");
    const ops = [];
    try { reader(buf, ops); } catch { return null; }
    return ops.length === 1 && !buf.available() ? ops[0] : null;
}

function blob(length) {
    const op = new Uint8Array(17 + length).fill(0xab);
    op.set([41, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255]);
    return op;
}

const cases = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
    const [tag, ...rest] = line.split(" ");
    if (tag === "CASE") { cases.push({ name: rest[0] }); continue; }
    const c = cases[cases.length - 1];
    if (!c) continue;
    if (tag === "HEX") c.op = unhex(rest[0]);
    else if (tag === "REJECT") c.reject = true;
    else if (tag === "ID" || tag === "TYPE" || tag === "FLAGS") c[tag] = Number(rest[0]);
    else if (tag === "DATA") c.data = unhex(rest[1] ?? "");
}
if (cases.length === 0) { console.error(`no cases in ${file}`); process.exit(1); }

let bad = 0;
for (const c of cases) {
    const d = load(c.op);
    if (c.reject) {
        if (d) { console.error(`FAIL ${c.name}: loaded a blob the reference refuses`); bad++; }
        else console.error(`ok   ${c.name}: refused`);
        continue;
    }
    if (!d) { console.error(`FAIL ${c.name}: did not load`); bad++; continue; }
    const objects = new Map();
    d.apply({ putObject: (id, v) => objects.set(id, v) });
    const data = d.getData();
    const sameData = data.length === c.data.length && data.every((b, i) => b === c.data[i]);
    if (d.getId() !== c.ID || d.getType() !== c.TYPE || d.getFlags() !== c.FLAGS || !sameData) {
        console.error(`FAIL ${c.name}: read id ${d.getId()} type ${d.getType()} flags ${d.getFlags()}, ${data.length} bytes`);
        bad++;
    } else if (objects.get(c.ID) !== d) {
        console.error(`FAIL ${c.name}: not stored under id ${c.ID}`);
        bad++;
    } else {
        console.error(`ok   ${c.name}: ${data.length} bytes under id ${c.ID}`);
    }
}

const atOk = load(blob(100_000)) !== null;
const overOk = load(blob(100_001)) !== null;
if (!atOk) { console.error("FAIL a blob of exactly MAX_BINARY_DATA was refused"); bad++; }
if (overOk) { console.error("FAIL a blob one byte over MAX_BINARY_DATA loaded"); bad++; }
if (atOk && !overOk) console.error("ok   the limit: 100000 loads, one more is refused");

console.error(`${cases.length + 1} cases, ${bad} failed`);
process.exit(bad ? 1 : 0);

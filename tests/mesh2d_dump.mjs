// What this player makes of ADD_MESH_2D / BINARY_DATA operations, for the three-way check
// (rcJson tools/xcheck/xcheck_mesh2d.py). Reads the cases file the Java side writes — CASE,
// HEX, VAR lines; its results are ignored — and prints the same format with this player's
// results: REJECT when the reader throws, else CONSUMED and the expansion or the blob.
//
//   node tests/mesh2d_dump.mjs CASES.txt > OUT.txt      (ESBUILD=<path> to skip npx)
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ts = path.join(here, "..");
if (!process.argv[2]) { console.error("usage: node tests/mesh2d_dump.mjs CASES.txt"); process.exit(2); }
const dir = mkdtempSync(path.join(os.tmpdir(), "mesh2d-dump-"));
const out = path.join(dir, "dump.mjs");
const entry = path.join(dir, "entry.ts");
writeFileSync(entry, `export { Operations } from ${JSON.stringify(path.join(ts, "src/core/Operations.ts"))};\n`
    + `export { WireBuffer } from ${JSON.stringify(path.join(ts, "src/core/WireBuffer.ts"))};\n`);
const [cmd, ...pre] = process.env.ESBUILD ? [process.env.ESBUILD] : ["npx", "esbuild"];
execFileSync(cmd, [...pre, entry, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${out}`, "--log-level=error"], { cwd: ts, stdio: ["ignore", "ignore", "inherit"] });
const { Operations, WireBuffer } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true });

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (f) => { f32[0] = f; return u32[0].toString(16); };
const lines = [];

function run(name, op, vars) {
    lines.push(`CASE ${name}`);
    const buf = WireBuffer.fromArrayBuffer(op.buffer.slice(op.byteOffset, op.byteOffset + op.length));
    const reader = Operations.getReader(buf.readByte());
    const ops = [];
    try { reader(buf, ops); } catch { lines.push("REJECT", "END"); return; }
    lines.push(`CONSUMED ${buf.getIndex()}`);
    const o = ops[0];
    if (typeof o.getData === "function") {
        const hex = Array.from(o.getData(), (b) => b.toString(16).padStart(2, "0")).join("");
        lines.push(`BLOB ${o.getId()} ${o.getType()} ${o.getFlags()} ${o.getData().length} ${hex}`, "END");
        return;
    }
    let mesh = null;
    const ctx = {
        listensTo() {},
        getFloat: (id) => vars.get(id) ?? 0,
        getPathData: () => null,
        getCollectionsAccess: () => null,
        getPaintContext: () => ({ setMesh: (...a) => { mesh = a; } }),
    };
    o.registerListening(ctx);
    o.updateVariables(ctx);
    o.apply(ctx);
    const [, , , , verts, uv, colors, indices] = mesh;
    lines.push(`VERTS ${verts.length}${Array.from(verts, (v) => " " + bits(v)).join("")}`);
    lines.push(`UV ${uv.length}${Array.from(uv, (v) => " " + bits(v)).join("")}`);
    lines.push(`COLORS ${colors.length}${Array.from(colors, (v) => " " + (v | 0)).join("")}`);
    lines.push(`INDICES ${indices.length}${Array.from(indices, (v) => " " + v).join("")}`);
    lines.push("END");
}

let name = null, op = null, vars = new Map();
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
    const [tag, ...rest] = line.split(" ");
    if (tag === "CASE") { name = rest[0]; vars = new Map(); }
    else if (tag === "HEX") op = Uint8Array.from(rest[0].match(/../g) ?? [], (h) => parseInt(h, 16));
    else if (tag === "VAR") { u32[0] = parseInt(rest[1], 16) >>> 0; vars.set(Number(rest[0]), f32[0]); }
    else if (tag === "END") run(name, op, vars);
}
process.stdout.write(lines.join("\n") + "\n");

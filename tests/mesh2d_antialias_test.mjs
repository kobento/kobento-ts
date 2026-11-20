// AddMesh2D FLAG_ANTIALIAS against the Java reference (same fixture as the C++ test): each case
// is an ADD_MESH_2D as the reference writes it and what the reference expands it to, the body
// followed by the skirt, or REJECT when its reader refuses the payload.
//
// Indices and colours must match exactly; positions get a small tolerance, and the largest
// difference is printed.
//
//   node tests/mesh2d_antialias_test.mjs [FILE.txt]      (ESBUILD=<path> to skip npx)
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ts = path.join(here, "..");
const file = process.argv[2] ?? path.join(process.env.KOBENTO_LIBS ?? path.join(here, "../../kobento-libs"), "tests/fixtures/mesh2d_antialias_java.txt");
const dir = mkdtempSync(path.join(os.tmpdir(), "mesh2d-aa-"));
const out = path.join(dir, "mesh.mjs");
const entry = path.join(dir, "entry.ts");
writeFileSync(entry, `export { AddMesh2D } from ${JSON.stringify(path.join(ts, "src/core/operations/Mesh2D.ts"))};\n`
    + `export { WireBuffer } from ${JSON.stringify(path.join(ts, "src/core/WireBuffer.ts"))};\n`);
// ESBUILD names an esbuild binary to use instead of `npx esbuild`.
const [cmd, ...pre] = process.env.ESBUILD ? [process.env.ESBUILD] : ["npx", "esbuild"];
execFileSync(cmd, [...pre, entry, "--bundle", "--platform=node", "--format=esm",
    `--outfile=${out}`, "--log-level=error"], { cwd: ts, stdio: "inherit" });
const { AddMesh2D, WireBuffer } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true });

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bitsToFloat = (h) => { u32[0] = parseInt(h, 16) >>> 0; return f32[0]; };

const cases = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
    const [tag, ...rest] = line.split(" ");
    if (tag === "CASE") { cases.push({ name: rest[0], vars: new Map() }); continue; }
    const c = cases[cases.length - 1];
    if (!c) continue;
    if (tag === "HEX") c.op = Uint8Array.from(rest[0].match(/../g), (h) => parseInt(h, 16));
    else if (tag === "VAR") c.vars.set(Number(rest[0]), Number(rest[1]));
    else if (tag === "REJECT") c.reject = true;
    else if (tag === "VERTS" || tag === "UV") c[tag] = rest.slice(1).map(bitsToFloat);
    else if (tag === "COLORS" || tag === "INDICES") c[tag] = rest.slice(1).map(Number);
}
if (cases.length === 0) { console.error(`no cases in ${file}`); process.exit(1); }

let bad = 0;
for (const c of cases) {
    const buf = WireBuffer.fromArrayBuffer(c.op.buffer.slice(c.op.byteOffset, c.op.byteOffset + c.op.length));
    buf.readByte();
    const ops = [];
    let threw = false;
    try { AddMesh2D.read(buf, ops); } catch { threw = true; }
    if (c.reject) {
        if (threw) console.error(`ok   ${c.name}: refused`);
        else { console.error(`FAIL ${c.name}: read accepted a mesh the reference refuses`); bad++; }
        continue;
    }
    if (threw || ops.length !== 1) { console.error(`FAIL ${c.name}: read refused it`); bad++; continue; }
    if (buf.available()) { console.error(`FAIL ${c.name}: read stopped at ${buf.getIndex()} of ${c.op.length} bytes`); bad++; continue; }

    let mesh = null;
    const ctx = {
        listensTo() {},
        getFloat: (id) => c.vars.get(id) ?? 0,
        getPathData: () => null,
        getCollectionsAccess: () => null,
        getPaintContext: () => ({ setMesh: (...a) => { mesh = a; } }),
    };
    ops[0].registerListening(ctx);
    ops[0].updateVariables(ctx);
    ops[0].apply(ctx);
    const [, , , , verts, uv, colors, indices] = mesh;

    const why = [];
    let worst = 0;
    const near = (got, want, what) => {
        if (got.length !== want.length) { why.push(`${what} size ${got.length} != ${want.length}`); return; }
        for (let i = 0; i < got.length; i++) {
            const d = Math.abs(got[i] - want[i]);
            worst = Math.max(worst, d);
            if (!(d <= 1e-4 * Math.max(1, Math.abs(want[i])))) { why.push(`${what}[${i}] ${got[i]} != ${want[i]}`); return; }
        }
    };
    const same = (got, want, what) => {
        if (got.length !== want.length || got.some((v, i) => v !== want[i])) why.push(`${what} differ`);
    };
    near(verts, c.VERTS, "verts");
    near(uv, c.UV, "uv");
    same(colors, c.COLORS, "colors");
    same(indices, c.INDICES, "indices");
    if (why.length) { console.error(`FAIL ${c.name}: ${why.join("; ")}`); bad++; }
    else console.error(`ok   ${c.name}: ${c.VERTS.length / 2} vertices, ${c.INDICES.length} indices, max |dpos| ${worst.toPrecision(3)}`);
}
console.error(`${cases.length} cases, ${bad} failed`);
process.exit(bad ? 1 : 0);

// 2D vertex meshes — ADD_MESH_2D (104), DRAW_MESH_2D (105), MATRIX_FROM_MESH_2D (106).
//
// Ported from androidx remote-core AddMesh2D.java / DrawMesh2D.java / MatrixFromMesh2D.java
// (2026-09; FLAG_ANTIALIAS 2026-11). The expression form evaluates nine channels over (u, v),
// which reach the evaluator as VAR1/VAR2 — the a[0]/a[1] slots — exactly as the reference
// binds them.

import { PaintOperation } from '../PaintOperation';
import { Operation } from '../Operation';
import type { PaintContext } from '../PaintContext';
import type { RemoteContext } from '../RemoteContext';
import type { WireBuffer } from '../WireBuffer';
import type { VariableSupport } from '../VariableSupport';
import { idFromBits, isNaNBits, intBitsToFloat, floatToRawIntBits } from './Utils';
import { FloatExpression } from './FloatExpression';

// AnimatedFloatExpression's operator range and the array-id region, as FloatExpression
// spells them. Duplicated rather than imported because they are private there.
const MESH_OP_OFFSET = 0x310000;
const MESH_ID_REGION_MASK = 0x700000;
const MESH_ID_REGION_ARRAY = 0x200000;
import * as G from './Mesh2DGenerator';

/**
 * Raw bits, not a float. These arrays mix literals with NaN-boxed variable ids, and a NaN id
 * does not survive being read as a float — Safari canonicalizes it and the id becomes 0.
 */
function isResolvableBits(bits: number): boolean {
    return isNaNBits(bits);
}

export class AddMesh2D extends Operation implements VariableSupport {
    static readonly OP_CODE = 104;

    /** In `flags`: grow an alpha-fading skirt around the mesh's edges. The payload then ends in
     * one more float, the skirt's width in the mesh's own units, which may be a variable. */
    static readonly FLAG_ANTIALIAS = 1 << 8;
    /** The bits of `flags` holding a TYPE_SPLINE_ROUND_STRIP's cap columns. */
    static readonly CAP_SEGMENTS_MASK = 0xff;
    static readonly DEFAULT_ANTIALIAS_WIDTH = 1;

    // FLAG_ANTIALIAS: the skirt's boundary loops depend only on the header, so they are worked
    // out once, as are the sizes they add and the woven triangle list (on first use).
    private readonly mAntialiasLoops: Int32Array[];
    private readonly mSkirtVertexCount: number;
    private readonly mSkirtIndexCount: number;
    private mSkirtIndices: Int32Array<ArrayBuffer> | null = null;

    // expanded geometry, in the layout drawVertices wants
    private mVerts = new Float32Array(0);
    private mUv = new Float32Array(0);
    private mColors = new Int32Array(0);
    private mIndices = new Int32Array(0);

    // u and v ride in the VAR1/VAR2 slots, which is exactly how the reference binds them.
    private mVars = [0, 0, 0];
    private mPolyline = new Float32Array(0);
    private mWidthSpline = new G.MonotonicSpline();
    // Renamed off the base class: Operation already declares a private field of the
    // original name, and TypeScript treats two separate private declarations of one
    // name as a type conflict, which reads as "incorrectly extends".
    private mMeshDirty = true;
    private mScratchPos = new Float32Array(2);
    private mScratchSample = new Float32Array(4);

    constructor(
        readonly mMeshId: number,
        readonly mType: number,
        readonly mLayout: number,
        readonly mUCount: number,
        readonly mVCount: number,
        readonly mFlags: number,
        readonly mAux: number,
        // Raw token BITS, not floats. A NaN-tagged operator written into a Float32Array is
        // canonicalised by some engines, which silently destroys the operator id — the
        // expression then evaluates to nothing and the mesh collapses to a point. The rest
        // of this codebase keeps expression tokens as Int32Array for the same reason.
        readonly mExpressions: Int32Array[],
        readonly mSrcIndices: Int32Array,
        readonly mSrcVerts: Int32Array,
        readonly mSrcUv: Float32Array,
        readonly mSrcColors: Int32Array,
        readonly mWidths: Int32Array,
        readonly mWidthPositions: Int32Array,
        // Raw bits, as the other payloads: may be a NaN-boxed variable id.
        readonly mAntialiasWidth: number = floatToRawIntBits(AddMesh2D.DEFAULT_ANTIALIAS_WIDTH),
    ) {
        super();
        const uc = Math.max(1, mUCount);
        const vc = Math.max(1, mVCount);
        this.mAntialiasLoops = this.isAntialiased
                && layoutVertexCount(mLayout, uc, vc) <= G.MAX_MESH_2D_GRID
            ? G.antialiasLoops(mLayout, uc, vc) : [];
        this.mSkirtVertexCount = G.antialiasVertexCount(this.mAntialiasLoops);
        this.mSkirtIndexCount = G.antialiasIndexCount(this.mAntialiasLoops);
    }

    /** Never a spline strip, which has no colours to fade. */
    private get isAntialiased(): boolean {
        return (this.mFlags & AddMesh2D.FLAG_ANTIALIAS) !== 0 && !this.isSplineStrip;
    }

    // Players read documents; they never write them. Stubbed as elsewhere in this tree.
    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        // Subscribe to every variable the nine channels reference, and to the literal payloads.
        //
        // This was a no-op at first, and the consequence was silent: with nothing registered
        // the op never receives updateVariables, so the mesh is expanded on the first frame and
        // never again. Every animated mesh rendered as a still, and because the geometry was
        // correct for t=0 it looked like a clock problem in the harness rather than a mesh that
        // had stopped being rebuilt.
        //
        // Operator and array tokens are skipped: they are NaN-tagged too, but they are not
        // variables and listening to them would register nonsense ids.
        const watch = (bits: number) => {
            if (!isNaNBits(bits)) return;
            const id = idFromBits(bits);
            if (id > MESH_OP_OFFSET && id <= MESH_OP_OFFSET + 79) return;       // operator
            if ((id & MESH_ID_REGION_MASK) === MESH_ID_REGION_ARRAY) return;    // array
            context.listensTo(id, this);
        };
        for (const g of this.mExpressions) {
            for (let i = 0; i < g.length; i++) watch(g[i]);       // already bits
        }
        for (const arr of [this.mSrcVerts, this.mWidths, this.mWidthPositions]) {
            for (let i = 0; i < arr.length; i++) {
                if (isNaNBits(arr[i])) context.listensTo(idFromBits(arr[i]), this);
            }
        }
        if (this.isAntialiased && isNaNBits(this.mAntialiasWidth)) {
            context.listensTo(idFromBits(this.mAntialiasWidth), this);
        }
    }
    markDirty(): void { this.mMeshDirty = true; }
    updateVariables(_context: RemoteContext): void { this.mMeshDirty = true; }

    apply(context: RemoteContext): void {
        if (this.mMeshDirty) { this.expand(context); this.mMeshDirty = false; }
        const pc = context.getPaintContext();
        if (pc) {
            pc.setMesh(this.mMeshId, this.mLayout, this.mUCount, this.mVCount,
                       this.mVerts, this.mUv, this.mColors, this.mIndices);
        }
    }

    deepToString(indent: string): string {
        return indent + 'AddMesh2D id=' + this.mMeshId + ' type=' + this.mType
             + ' layout=' + this.mLayout;
    }

    private get isSplineStrip(): boolean {
        return this.mType === G.TYPE_PATH_SPLINE_STRIP
            || this.mType === G.TYPE_SPLINE_ROUND_STRIP;
    }

    private val(context: RemoteContext, bits: number): number {
        return isResolvableBits(bits)
            ? context.getFloat(idFromBits(bits)) : intBitsToFloat(bits);
    }

    private expand(context: RemoteContext): void {
        if (this.mType === G.TYPE_EXPRESSION || this.isSplineStrip) {
            this.expandParametric(context);
        } else {
            this.expandLiteral(context);
        }
    }

    private expandLiteral(context: RemoteContext): void {
        const n = this.mSrcVerts.length;
        const verts = new Float32Array(n);
        for (let i = 0; i < n; i++) verts[i] = this.val(context, this.mSrcVerts[i]);
        this.mVerts = verts;
        const vertexCount = n / 2;
        this.mUv = this.mSrcUv.length === n
            ? new Float32Array(this.mSrcUv) : new Float32Array(0);
        this.mColors = this.mSrcColors.length === vertexCount
            ? new Int32Array(this.mSrcColors) : new Int32Array(0);
        // The wire format guarantees these for an antialiased mesh; without them the mesh is
        // drawn without a skirt rather than with a wrong one.
        const skirt = this.mSkirtVertexCount > 0
            && this.mSrcColors.length === vertexCount
            && G.vertexCount(this.mLayout, this.mUCount, this.mVCount) === vertexCount;
        if (!skirt) {
            this.mIndices = new Int32Array(this.mSrcIndices);
            return;
        }
        this.mVerts = grow(verts, (vertexCount + this.mSkirtVertexCount) * 2);
        if (this.mUv.length > 0) {
            this.mUv = grow(this.mUv, (vertexCount + this.mSkirtVertexCount) * 2);
        }
        this.mColors = growInt(this.mColors, vertexCount + this.mSkirtVertexCount);
        this.appendSkirt(context, vertexCount);
        this.mIndices = this.skirtIndices(vertexCount);
    }

    private appendSkirt(context: RemoteContext, bodyVertexCount: number): void {
        G.appendAntialiasSkirt(this.mLayout, Math.max(1, this.mUCount), Math.max(1, this.mVCount),
                               this.mAntialiasLoops, this.val(context, this.mAntialiasWidth),
                               this.mVerts, this.mUv, this.mColors, bodyVertexCount);
    }

    /** The body's triangles with the skirt's woven in; topology only, so worked out once. */
    private skirtIndices(bodyVertexCount: number): Int32Array<ArrayBuffer> {
        if (this.mSkirtIndices === null) {
            const body = this.mType === G.TYPE_EXPRESSION || this.isSplineStrip
                ? G.generateIndices(this.mLayout, Math.max(1, this.mUCount),
                                    Math.max(1, this.mVCount))
                : this.mSrcIndices;
            this.mSkirtIndices = G.antialiasIndices(body, this.mAntialiasLoops, bodyVertexCount);
        }
        return this.mSkirtIndices;
    }

    private roundCapColumns(): number {
        if (this.mType !== G.TYPE_SPLINE_ROUND_STRIP) return 0;
        // Masked, so FLAG_ANTIALIAS in the same word is not read as cap columns.
        const cap = this.mFlags & AddMesh2D.CAP_SEGMENTS_MASK;
        if (cap < 1) return 0;
        // flags arrives from the wire; leave at least one body column.
        const columns = this.mUCount - 1;
        if (columns < 3) return 0;
        return Math.min(cap, Math.trunc((columns - 1) / 2));
    }

    private evaluate(context: RemoteContext, group: number, u: number, v: number,
                     fallback: number): number {
        const e = this.mExpressions[group];
        if (!e || e.length === 0) return fallback;
        // A single element that is not a NaN token is a literal, not a program — the common
        // case for a channel given as a plain number, and the reference short-circuits it the
        // same way. Compare on the BITS: the value is stored as bits, so the float has to be
        // reconstructed before it can be returned.
        if (e.length === 1 && !isNaNBits(e[0])) return intBitsToFloat(e[0]);
        this.mVars[0] = u;
        this.mVars[1] = v;
        return FloatExpression.evalRPN(context, e, this.mVars);
    }

    private strokeWidthAt(context: RemoteContext, fraction: number, v: number): number {
        if (this.isSplineStrip) {
            return this.mWidthSpline.isEmpty ? 1 : this.mWidthSpline.at(fraction);
        }
        return this.evaluate(context, G.EXP_WIDTH, fraction, v, 1);
    }

    private buildWidthSpline(context: RemoteContext): void {
        const n = this.mWidths.length;
        if (n === 0) return;
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < n; i++) {
            const pos = this.mWidthPositions.length === n
                ? this.val(context, this.mWidthPositions[i])
                : (n === 1 ? 0 : i / (n - 1));
            xs.push(pos);
            ys.push(this.val(context, this.mWidths[i]));
        }
        this.mWidthSpline.fit(xs, ys);
    }

    private positionOnPath(context: RemoteContext, u: number, v: number, points: number,
                           out: Float32Array): void {
        const sample = this.mScratchSample;
        let fraction = u;
        const capColumns = this.roundCapColumns();
        if (capColumns > 0 && this.mUCount > 1) {
            const capSpan = capColumns / (this.mUCount - 1);
            if (u <= capSpan) {
                G.samplePolyline(this.mPolyline, points, 0, sample);
                const hw = this.strokeWidthAt(context, 0, v) * 0.5;
                G.roundCapPoint(sample, hw, capSpan > 0 ? u / capSpan : 0, v, -1, out);
                return;
            }
            if (u >= 1 - capSpan) {
                G.samplePolyline(this.mPolyline, points, 1, sample);
                const hw = this.strokeWidthAt(context, 1, v) * 0.5;
                G.roundCapPoint(sample, hw, capSpan > 0 ? (1 - u) / capSpan : 0, v, 1, out);
                return;
            }
            fraction = (u - capSpan) / (1 - 2 * capSpan);
        }
        G.samplePolyline(this.mPolyline, points, fraction, sample);
        const halfWidth = this.strokeWidthAt(context, fraction, v) * 0.5;
        const offset = (v - 0.5) * 2 * halfWidth;
        const nx = -sample[3];
        const ny = sample[2];                      // the tangent turned a quarter turn
        out[0] = sample[0] + nx * offset;
        out[1] = sample[1] + ny * offset;
    }

    private expandParametric(context: RemoteContext): void {
        const uc = Math.max(1, this.mUCount);
        const vc = Math.max(1, this.mVCount);
        const total = G.vertexCount(this.mLayout, uc, vc);
        if (total <= 0 || total > G.MAX_MESH_2D_VERTICES) return;
        const texU = this.mExpressions[G.EXP_TEX_U];
        const texV = this.mExpressions[G.EXP_TEX_V];
        const hasTex = (texU ? texU.length : 0) > 0 || (texV ? texV.length : 0) > 0;
        const ca = this.mExpressions[G.EXP_COLOR_A];
        const cr = this.mExpressions[G.EXP_COLOR_R];
        const cg = this.mExpressions[G.EXP_COLOR_G];
        const cb = this.mExpressions[G.EXP_COLOR_B];
        const hasColor = (ca ? ca.length : 0) > 0 || (cr ? cr.length : 0) > 0
                      || (cg ? cg.length : 0) > 0 || (cb ? cb.length : 0) > 0;
        // As for the literal types: the skirt is its colours, so without them there is none.
        const skirt = this.mSkirtVertexCount > 0 && hasColor;
        const all = total + (skirt ? this.mSkirtVertexCount : 0);
        const verts = new Float32Array(all * 2);
        const uv = new Float32Array(all * 2);
        const colors = hasColor ? new Int32Array(all) : new Int32Array(0);

        let points = 0;
        if (this.mLayout === G.LAYOUT_PATH_STRIP) {
            const raw = context.getPathData(this.mAux);
            if (raw) {
                // getPathData hands back the raw 32-bit words; the verb stream IS floats, so
                // reinterpret rather than convert — a numeric cast would destroy the NaN tags.
                const asFloats = new Float32Array(
                    raw.buffer as ArrayBuffer, raw.byteOffset, raw.length);
                this.mPolyline = G.flattenPath(asFloats, (f) => {
                    if (!Number.isNaN(f)) return f;
                    const id = G.pathNanId(f);
                    if (id >= G.PATH_MOVE && id <= G.PATH_DONE) return f;   // a verb, not a var
                    return context.getFloat(id);
                });
                points = this.mPolyline.length / 2;
            }
            if (this.isSplineStrip) this.buildWidthSpline(context);
        }

        const fan = this.mLayout === G.LAYOUT_FAN;
        const pos = this.mScratchPos;
        for (let index = 0; index < total; index++) {
            let u: number;
            let v: number;
            if (fan) {
                if (index === 0) { u = 0; v = 0; }
                else { u = G.domainU(this.mLayout, index - 1, uc); v = 1; }
            } else {
                u = G.domainU(this.mLayout, index % uc, uc);
                v = G.domainV(Math.trunc(index / uc), vc);
            }

            if (this.mLayout === G.LAYOUT_PATH_STRIP && points > 0) {
                this.positionOnPath(context, u, v, points, pos);
            } else {
                G.defaultPosition(this.mLayout, u, v, pos);
            }

            verts[index * 2] = this.evaluate(context, G.EXP_X, u, v, pos[0]);
            verts[index * 2 + 1] = this.evaluate(context, G.EXP_Y, u, v, pos[1]);

            if (hasTex) {
                uv[index * 2] = this.evaluate(context, G.EXP_TEX_U, u, v, u);
                uv[index * 2 + 1] = this.evaluate(context, G.EXP_TEX_V, u, v, v);
            } else {
                uv[index * 2] = u;
                uv[index * 2 + 1] = v;
            }

            if (hasColor) {
                colors[index] = G.packColor(
                    this.evaluate(context, G.EXP_COLOR_A, u, v, 1),
                    this.evaluate(context, G.EXP_COLOR_R, u, v, 1),
                    this.evaluate(context, G.EXP_COLOR_G, u, v, 1),
                    this.evaluate(context, G.EXP_COLOR_B, u, v, 1));
            }
        }

        this.mVerts = verts;
        this.mUv = uv;
        this.mColors = colors;
        if (skirt) {
            this.appendSkirt(context, total);
            this.mIndices = this.skirtIndices(total);
        } else {
            this.mIndices = G.generateIndices(this.mLayout, uc, vc);
        }
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const meshId = buffer.readId();
        const type = buffer.readInt();
        const layout = buffer.readInt();
        const uCount = buffer.readInt();
        const vCount = buffer.readInt();
        const flags = buffer.readInt();
        const aux = buffer.readInt();

        const expressions: Int32Array[] = [];
        let srcIndices = new Int32Array(0);
        let srcVerts = new Int32Array(0);
        let srcUv = new Float32Array(0);
        let srcColors = new Int32Array(0);
        let widths = new Int32Array(0);
        let widthPositions = new Int32Array(0);

        if (type === G.TYPE_EXPRESSION) {
            // Nine groups unconditionally: an absent channel is a zero length, not a missing
            // field, so reading fewer desynchronises the rest of the buffer.
            for (let g = 0; g < G.EXPRESSION_GROUPS; g++) {
                const len = buffer.readInt();
                const arr = new Int32Array(Math.max(0, len));
                for (let i = 0; i < len; i++) arr[i] = buffer.readNanIdBits();
                expressions.push(arr);
            }
        } else if (type === G.TYPE_PATH_SPLINE_STRIP || type === G.TYPE_SPLINE_ROUND_STRIP) {
            const wn = buffer.readInt();
            widths = new Int32Array(Math.max(0, wn));
            for (let i = 0; i < wn; i++) widths[i] = buffer.readNanIdBits();
            const pn = buffer.readInt();
            widthPositions = new Int32Array(Math.max(0, pn));
            for (let i = 0; i < pn; i++) widthPositions[i] = buffer.readNanIdBits();
            for (let g = 0; g < G.EXPRESSION_GROUPS; g++) expressions.push(new Int32Array(0));
        } else {
            const indexCount = buffer.readInt();
            srcIndices = new Int32Array(Math.max(0, indexCount));
            for (let i = 0; i < indexCount; i++) srcIndices[i] = buffer.readShort() & 0xffff;
            const vertCount = buffer.readInt();
            const uvCount = buffer.readInt();
            const colorCount = buffer.readInt();
            srcVerts = new Int32Array(Math.max(0, vertCount));
            srcUv = new Float32Array(Math.max(0, uvCount));
            srcColors = new Int32Array(Math.max(0, colorCount));
            if (type === G.TYPE_F16_VALUES) {
                for (let i = 0; i < vertCount; i++) {
                    // f16 cannot encode a 22-bit id, so these are genuine literals; store
                    // their bits so the array has one representation throughout.
                    srcVerts[i] = floatToRawIntBits(G.halfToFloat(buffer.readShort() & 0xffff));
                }
                for (let i = 0; i < uvCount; i++) {
                    srcUv[i] = G.halfToFloat(buffer.readShort() & 0xffff);
                }
            } else {
                for (let i = 0; i < vertCount; i++) srcVerts[i] = buffer.readNanIdBits();
                for (let i = 0; i < uvCount; i++) srcUv[i] = buffer.readFloat();
            }
            for (let i = 0; i < colorCount; i++) srcColors[i] = buffer.readInt();
            for (let g = 0; g < G.EXPRESSION_GROUPS; g++) expressions.push(new Int32Array(0));
        }

        let antialiasWidth = floatToRawIntBits(AddMesh2D.DEFAULT_ANTIALIAS_WIDTH);
        if ((flags & AddMesh2D.FLAG_ANTIALIAS) !== 0) {
            antialiasWidth = buffer.readNanIdBits();
            validateAntialias(type, layout, uCount, vCount, expressions,
                              srcVerts.length / 2, srcColors.length, antialiasWidth);
        }

        operations.push(new AddMesh2D(meshId, type, layout, uCount, vCount, flags, aux,
                                      expressions, srcIndices, srcVerts, srcUv, srcColors,
                                      widths, widthPositions, antialiasWidth));
    }
}

/** A copy of `a` at length `n`, its tail zeroed: room for the skirt after the body. */
function grow(a: Float32Array, n: number): Float32Array<ArrayBuffer> {
    const out = new Float32Array(n);
    out.set(a.subarray(0, Math.min(a.length, n)));
    return out;
}
function growInt(a: Int32Array, n: number): Int32Array<ArrayBuffer> {
    const out = new Int32Array(n);
    out.set(a.subarray(0, Math.min(a.length, n)));
    return out;
}

/** Vertices a layout gives these counts, guarded against a corrupt header wrapping round. */
function layoutVertexCount(layout: number, uCount: number, vCount: number): number {
    return layout === G.LAYOUT_FAN ? uCount + 1 : uCount * vCount;
}

/**
 * Reject a FLAG_ANTIALIAS mesh whose skirt cannot be built, as the reference does on read: the
 * skirt fades the vertex colours, so they must be there, and it grows from the boundary the
 * layout describes, so the layout must describe every vertex.
 */
function validateAntialias(type: number, layout: number, uCount: number, vCount: number,
                           expressions: Int32Array[], vertexCount: number, colorCount: number,
                           widthBits: number): void {
    if (type === G.TYPE_PATH_SPLINE_STRIP || type === G.TYPE_SPLINE_ROUND_STRIP) {
        throw new Error('Mesh2D spline strips have no colours to antialias with');
    }
    // A NaN is a variable, only known at playback.
    if (!isNaNBits(widthBits)) {
        const w = intBitsToFloat(widthBits);
        if (!(w >= 0 && w < Infinity)) {
            throw new Error('Mesh2D antialias width must be finite and not negative: ' + w);
        }
    }
    if (type === G.TYPE_EXPRESSION) {
        let hasColor = false;
        for (let g = G.EXP_COLOR_A; g <= G.EXP_COLOR_B && g < expressions.length; g++) {
            if (expressions[g].length > 0) hasColor = true;
        }
        if (!hasColor) throw new Error('Mesh2D antialiasing needs vertex colours; set a colour channel');
        const u = Math.max(1, uCount);
        const v = Math.max(1, vCount);
        if (layoutVertexCount(layout, u, v) > G.MAX_MESH_2D_GRID
            || G.antialiasLoops(layout, u, v).length === 0) {
            throw new Error('Mesh2D grid ' + uCount + 'x' + vCount + ' has no edges to antialias');
        }
        return;
    }
    if (colorCount !== vertexCount) {
        throw new Error('Mesh2D antialiasing needs one colour per vertex, got ' + colorCount
                        + ' for ' + vertexCount + ' vertices');
    }
    if (layoutVertexCount(layout, uCount, vCount) !== vertexCount
        || G.antialiasLoops(layout, uCount, vCount).length === 0) {
        throw new Error('Mesh2D antialiasing needs a layout that describes every vertex, but '
                        + uCount + 'x' + vCount + ' does not match ' + vertexCount + ' vertices');
    }
}

export class DrawMesh2D extends PaintOperation {
    static readonly OP_CODE = 105;

    constructor(readonly mMeshId: number, readonly mBlend: number, readonly mImageId: number) {
        super();
    }

    // Players read documents; they never write them. Stubbed as elsewhere in this tree.
    write(_buffer: WireBuffer): void { /* stub */ }

    paint(context: PaintContext): void {
        context.drawMesh(this.mMeshId, this.mBlend, this.mImageId);
    }

    deepToString(indent: string): string {
        return indent + 'DrawMesh2D ' + this.mMeshId;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new DrawMesh2D(buffer.readId(), buffer.readInt(), buffer.readInt()));
    }
}

export class MatrixFromMesh2D extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 106;

    private mOutU = 0;
    private mOutV = 0;

    constructor(readonly mMeshId: number, readonly mU: number, readonly mV: number,
                readonly mFlags: number) {
        super();
        this.mOutU = mU;
        this.mOutV = mV;
    }

    // Players read documents; they never write them. Stubbed as elsewhere in this tree.
    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (isResolvableBits(this.mU)) context.listensTo(idFromBits(this.mU), this);
        if (isResolvableBits(this.mV)) context.listensTo(idFromBits(this.mV), this);
    }

    markDirty(): void { /* recomputed from the context each frame */ }

    updateVariables(context: RemoteContext): void {
        this.mOutU = isResolvableBits(this.mU)
            ? context.getFloat(idFromBits(this.mU)) : intBitsToFloat(this.mU);
        this.mOutV = isResolvableBits(this.mV)
            ? context.getFloat(idFromBits(this.mV)) : intBitsToFloat(this.mV);
    }

    paint(context: PaintContext): void {
        context.matrixFromMesh(this.mMeshId, this.mOutU, this.mOutV, this.mFlags);
    }

    deepToString(indent: string): string {
        return indent + 'MatrixFromMesh2D ' + this.mMeshId;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        // u and v as raw bits: either may be a NaN-boxed variable.
        operations.push(new MatrixFromMesh2D(buffer.readId(), buffer.readNanIdBits(),
                                             buffer.readNanIdBits(), buffer.readInt()));
    }
}

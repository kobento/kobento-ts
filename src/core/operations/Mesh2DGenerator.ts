// Mesh2DGenerator: the geometry shared by every 2D vertex mesh.
//
// Ported from androidx remote-core operations/utilities/Mesh2DGenerator.java (2026-09). The
// generated vertices are part of the contract, not an implementation detail: a document is
// authored against one player and drawn on another, so these have to match the reference for
// the same input rather than merely look similar.

export const LAYOUT_GRID = 0;
export const LAYOUT_POLAR = 1;
export const LAYOUT_RING = 2;
export const LAYOUT_STRIP = 3;
export const LAYOUT_FAN = 4;
export const LAYOUT_PATH_STRIP = 5;

export const TYPE_EXPRESSION = 0;
export const TYPE_VALUES = 1;
export const TYPE_F16_VALUES = 2;
export const TYPE_PATH_SPLINE_STRIP = 3;
export const TYPE_SPLINE_ROUND_STRIP = 4;

export const BLEND_COLORS_ONLY = 0;
export const BLEND_MODULATE = 1;
export const NO_IMAGE = 0;

export const FLAG_ORIGIN = 0;
export const FLAG_ROTATION = 1;
export const FLAG_SCALE = 2;
export const FLAG_FULL = 3;

export const EXPRESSION_GROUPS = 9;
export const EXP_X = 0, EXP_Y = 1, EXP_TEX_U = 2, EXP_TEX_V = 3;
export const EXP_COLOR_A = 4, EXP_COLOR_R = 5, EXP_COLOR_G = 6, EXP_COLOR_B = 7;
export const EXP_WIDTH = 8;

export const MIN_ROUND_CAP_SEGMENTS = 3;
export const MAX_ROUND_CAP_SEGMENTS = 16;
const DEFAULT_RING_INNER_RADIUS = 0.5;
const TWO_PI = 6.2831855;
const HALF_PI = 1.5707964;
const DEGENERATE_EPSILON = 1e-6;

// Limits.java, mirrored so a malformed document is refused rather than allocating wildly.
export const MAX_MESH_2D_VERTICES = 16384;
export const MAX_MESH_2D_INDICES = 49152;
export const MAX_MESH_2D_GRID = 16384;

export function wrapsU(layout: number): boolean {
    return layout === LAYOUT_POLAR || layout === LAYOUT_RING || layout === LAYOUT_FAN;
}

export function vertexCount(layout: number, uCount: number, vCount: number): number {
    if (layout === LAYOUT_FAN) return uCount + 1;   // shared centre plus a rim
    return uCount * vCount;
}

export function indexCount(layout: number, uCount: number, vCount: number): number {
    if (layout === LAYOUT_FAN) return uCount * 3;
    if (vCount < 2 || uCount < 2) return 0;
    const columns = wrapsU(layout) ? uCount : uCount - 1;
    return columns * (vCount - 1) * 6;
}

// A wrapping layout divides by uCount so the sample after the last is the first; a
// non-wrapping one divides by uCount-1 so the domain is closed at both ends.
// The domain and the default positions are computed in float32, as the reference computes
// them: in double, cos(u * 2pi) at a quarter turn is -4.8e-8 where the reference has -4.4e-8,
// and an antialiasing skirt grown beside such a point magnifies that into a visible 3e-4.
const fr = Math.fround;

export function domainU(layout: number, i: number, uCount: number): number {
    if (uCount <= 1) return 0;
    if (wrapsU(layout)) return fr(i / uCount);
    return fr(i / (uCount - 1));
}

export function domainV(j: number, vCount: number): number {
    if (vCount <= 1) return 0;
    return fr(j / (vCount - 1));
}

export function generateIndices(layout: number, uCount: number,
                                vCount: number): Int32Array<ArrayBuffer> {
    const out = new Int32Array(Math.max(0, indexCount(layout, uCount, vCount)));
    let k = 0;
    if (layout === LAYOUT_FAN) {
        for (let i = 0; i < uCount; i++) {         // vertex 0 is the centre
            out[k++] = 0;
            out[k++] = 1 + i;
            out[k++] = 1 + ((i + 1) % uCount);
        }
        return out;
    }
    if (vCount < 2 || uCount < 2) return out;
    const wrap = wrapsU(layout);
    const columns = wrap ? uCount : uCount - 1;
    for (let j = 0; j < vCount - 1; j++) {
        for (let i = 0; i < columns; i++) {
            const i1 = wrap ? (i + 1) % uCount : i + 1;
            const topLeft = j * uCount + i;
            const topRight = j * uCount + i1;
            const bottomLeft = (j + 1) * uCount + i;
            const bottomRight = (j + 1) * uCount + i1;
            out[k++] = topLeft;  out[k++] = bottomLeft; out[k++] = topRight;
            out[k++] = topRight; out[k++] = bottomLeft; out[k++] = bottomRight;
        }
    }
    return out;
}

// ── antialiasing skirt (AddMesh2D FLAG_ANTIALIAS) ─────────────────────────────────────────
//
// drawVertices does not antialias triangle edges, so a mesh stops at a hard, stepped edge. The
// skirt is a band of vertices just outside each boundary loop that repeat their neighbour's
// colour and uv at alpha 0, so the edge fades out over `width` instead. Ported from androidx
// Mesh2DGenerator (2026-11): which vertices, in which order, and which triangles join them are
// part of the contract, since MatrixFromMesh2D and the painter's order both depend on them.

/** The furthest a skirt vertex is pushed out at a corner, as a multiple of the width: SVG's
 * default miter limit. */
export const ANTIALIAS_MAX_MITER = 4;

/**
 * The boundary loops of a layout, each a closed ring of body vertex indices listed in the
 * direction the body's own triangles run along it. A grid-wired layout has one loop around all
 * four sides; polar and ring have two (first row, last row); a fan has one, its rim. Empty when
 * the counts describe no area.
 */
export function antialiasLoops(layout: number, uCount: number, vCount: number): Int32Array[] {
    switch (layout) {
        case LAYOUT_FAN: {
            if (uCount < 3) return [];
            const rim = new Int32Array(uCount);
            for (let i = 0; i < uCount; i++) rim[i] = 1 + i;
            return [rim];
        }
        case LAYOUT_POLAR:
        case LAYOUT_RING: {
            if (uCount < 3 || vCount < 2) return [];
            // The body's triangles run along the first row backwards and the last forwards.
            const first = new Int32Array(uCount);
            const last = new Int32Array(uCount);
            const lastRow = (vCount - 1) * uCount;
            for (let i = 0; i < uCount; i++) {
                first[i] = (uCount - i) % uCount;
                last[i] = lastRow + i;
            }
            return [first, last];
        }
        default: {
            // Anything else is wired as a grid by generateIndices, so it is bounded as one.
            if (uCount < 2 || vCount < 2) return [];
            const loop = new Int32Array(2 * (uCount + vCount) - 4);
            let k = 0;
            // Down the first column, along the last row, up the last column, back along row 0.
            for (let j = 0; j < vCount; j++) loop[k++] = j * uCount;
            for (let i = 1; i < uCount; i++) loop[k++] = (vCount - 1) * uCount + i;
            for (let j = vCount - 2; j >= 0; j--) loop[k++] = j * uCount + uCount - 1;
            for (let i = uCount - 2; i >= 1; i--) loop[k++] = i;
            return [loop];
        }
    }
}

/** The vertices a skirt around `loops` adds: one per loop vertex. */
export function antialiasVertexCount(loops: Int32Array[]): number {
    let count = 0;
    for (const loop of loops) count += loop.length;
    return count;
}

/** The indices a skirt around `loops` adds: two triangles per loop edge. */
export function antialiasIndexCount(loops: Int32Array[]): number {
    return antialiasVertexCount(loops) * 6;
}

/**
 * Grow the skirt into the tail of the arrays, after the first `bodyVertexCount` vertices; the
 * arrays must already have room for it. A loop or body with no area gets a skirt of zero width:
 * it keeps its vertex slots, so the sizes never depend on the geometry, but it draws nothing.
 */
export function appendAntialiasSkirt(layout: number, uCount: number, vCount: number,
                                     loops: Int32Array[], width: number,
                                     verts: Float32Array, uv: Float32Array, colors: Int32Array,
                                     bodyVertexCount: number): void {
    // NaN, an unresolved variable, fails the comparison and so collapses the skirt too.
    const reach = width > 0 && width < Infinity ? width : 0;
    let base = bodyVertexCount;
    for (const loop of loops) {
        const n = loop.length;
        const normals = new Float32Array(2 * n);
        const side = reach > 0 ? outwardSide(layout, uCount, vCount, loop, verts) : 0;
        if (side !== 0 && edgeNormals(loop, verts, side, normals)) {
            skirtPositions(loop, verts, reach, side, normals, base);
        } else {
            for (let e = 0; e < n; e++) {
                verts[(base + e) * 2] = verts[loop[e] * 2];
                verts[(base + e) * 2 + 1] = verts[loop[e] * 2 + 1];
            }
        }
        for (let e = 0; e < n; e++) {
            const a = loop[e];
            const skirtA = base + e;
            if (uv.length > 0) {
                uv[skirtA * 2] = uv[a * 2];
                uv[skirtA * 2 + 1] = uv[a * 2 + 1];
            }
            if (colors.length > 0) colors[skirtA] = colors[a] & 0x00ffffff;
        }
        base += n;
    }
}

/**
 * The body's triangles in their own order, each followed by the skirt along whichever of its
 * edges lie on a loop, so a mesh that overlaps itself keeps its painter's order. A loop edge no
 * triangle runs along (only a hand-built list has one) gets its skirt after everything else.
 */
export function antialiasIndices(bodyIndices: Int32Array, loops: Int32Array[],
                                 bodyVertexCount: number): Int32Array<ArrayBuffer> {
    const edgeCount = antialiasVertexCount(loops);
    const out = new Int32Array(bodyIndices.length + edgeCount * 6);
    // Each loop edge a -> b with the skirt vertices beyond them, found from a by way of the edge
    // that leaves it. No vertex is on a loop twice.
    const edges = new Int32Array(edgeCount * 4);
    const leaving = new Int32Array(bodyVertexCount).fill(-1);
    let edge = 0;
    let base = bodyVertexCount;
    for (const loop of loops) {
        const n = loop.length;
        for (let e = 0; e < n; e++) {
            edges[edge * 4] = loop[e];
            edges[edge * 4 + 1] = loop[(e + 1) % n];
            edges[edge * 4 + 2] = base + e;
            edges[edge * 4 + 3] = base + (e + 1) % n;
            if (loop[e] >= 0 && loop[e] < bodyVertexCount) leaving[loop[e]] = edge;
            edge++;
        }
        base += n;
    }

    const loopEdge = (a: number, b: number): number => {
        if (a >= 0 && a < leaving.length) {
            const e = leaving[a];
            if (e >= 0 && edges[e * 4 + 1] === b) return e;
        }
        if (b >= 0 && b < leaving.length) {
            const e = leaving[b];
            if (e >= 0 && edges[e * 4 + 1] === a) return e;
        }
        return -1;
    };
    let k = 0;
    const skirtTriangles = (e: number): void => {
        const a = edges[e * 4], b = edges[e * 4 + 1];
        const skirtA = edges[e * 4 + 2], skirtB = edges[e * 4 + 3];
        // The body's triangle runs a -> b, so the skirt's runs b -> a: the same winding.
        out[k++] = b; out[k++] = a; out[k++] = skirtA;
        out[k++] = b; out[k++] = skirtA; out[k++] = skirtB;
    };

    const drawn = new Uint8Array(edgeCount);
    const wholeTriangles = Math.trunc(bodyIndices.length / 3) * 3;
    for (let t = 0; t < wholeTriangles; t += 3) {
        out[k++] = bodyIndices[t];
        out[k++] = bodyIndices[t + 1];
        out[k++] = bodyIndices[t + 2];
        for (let s = 0; s < 3; s++) {
            const e = loopEdge(bodyIndices[t + s], bodyIndices[t + (s + 1) % 3]);
            if (e >= 0 && !drawn[e]) { drawn[e] = 1; skirtTriangles(e); }
        }
    }
    for (let e = 0; e < edgeCount; e++) if (!drawn[e]) skirtTriangles(e);
    // Indices past the last whole triangle draw nothing, and stay last so they join nothing.
    for (let i = wholeTriangles; i < bodyIndices.length; i++) out[k++] = bodyIndices[i];
    return out;
}

/** A vertex one step into the body from a boundary vertex; only its side matters. */
function antialiasInward(layout: number, uCount: number, vCount: number, vertex: number): number {
    if (layout === LAYOUT_FAN) return 0;
    const i = vertex % uCount;
    const j = Math.trunc(vertex / uCount);
    if (layout === LAYOUT_POLAR || layout === LAYOUT_RING) {
        return (j === 0 ? 1 : vCount - 2) * uCount + i;
    }
    const ii = i === 0 ? 1 : (i === uCount - 1 ? uCount - 2 : i);
    const jj = j === 0 ? 1 : (j === vCount - 1 ? vCount - 2 : j);
    return jj * uCount + ii;
}

/** Which side of the loop the body is on, by a vote of every edge: 1 when outward is
 * (dy, -dx), -1 for the reverse, 0 when the body beside the loop has no area. */
function outwardSide(layout: number, uCount: number, vCount: number, loop: Int32Array,
                     verts: Float32Array): number {
    let vote = 0;
    let magnitude = 0;
    const n = loop.length;
    for (let e = 0; e < n; e++) {
        const a = loop[e];
        const b = loop[(e + 1) % n];
        const c = antialiasInward(layout, uCount, vCount, a);
        const ax = verts[a * 2], ay = verts[a * 2 + 1];
        const dx = verts[b * 2] - ax, dy = verts[b * 2 + 1] - ay;
        const cx = verts[c * 2] - ax, cy = verts[c * 2 + 1] - ay;
        vote += dx * cy - dy * cx;
        magnitude += Math.hypot(dx, dy) * Math.hypot(cx, cy);
    }
    if (!(Math.abs(vote) > 1e-6 * magnitude)) return 0;
    return vote > 0 ? 1 : -1;
}

/** Each loop edge's unit outward normal, zero for an edge with no length; false if no edge
 * has any. */
function edgeNormals(loop: Int32Array, verts: Float32Array, side: number,
                     normals: Float32Array): boolean {
    const n = loop.length;
    let any = false;
    for (let e = 0; e < n; e++) {
        const a = loop[e];
        const b = loop[(e + 1) % n];
        // Float32 differences, as the reference takes them, so near-degenerate edges are judged
        // the same way.
        const dx = Math.fround(verts[b * 2] - verts[a * 2]);
        const dy = Math.fround(verts[b * 2 + 1] - verts[a * 2 + 1]);
        const length = Math.fround(Math.hypot(dx, dy));
        if (length > DEGENERATE_EPSILON) {
            normals[e * 2] = side * dy / length;
            normals[e * 2 + 1] = -side * dx / length;
            any = true;
        } else {
            normals[e * 2] = 0;
            normals[e * 2 + 1] = 0;
        }
    }
    return any;
}

function hasNormal(normals: Float32Array, edge: number): boolean {
    return normals[edge * 2] !== 0 || normals[edge * 2 + 1] !== 0;
}

/**
 * Place each skirt vertex on the mitred bisector of the nearest edges with length on either
 * side. Two passes: the backward one parks the normal of the edge after each vertex in that
 * vertex's skirt slot; the forward one combines it with the edge before and overwrites the slot.
 */
function skirtPositions(loop: Int32Array, verts: Float32Array, reach: number, side: number,
                        normals: Float32Array, base: number): void {
    const n = loop.length;
    let next = 0;
    while (!hasNormal(normals, next)) next++;
    for (let k = n - 1; k >= 0; k--) {
        if (hasNormal(normals, k)) next = k;
        verts[(base + k) * 2] = normals[next * 2];
        verts[(base + k) * 2 + 1] = normals[next * 2 + 1];
    }

    let previous = n - 1;
    while (!hasNormal(normals, previous)) previous--;
    const limit = ANTIALIAS_MAX_MITER * ANTIALIAS_MAX_MITER;
    for (let k = 0; k < n; k++) {
        if (k > 0 && hasNormal(normals, k - 1)) previous = k - 1;
        const px = normals[previous * 2];
        const py = normals[previous * 2 + 1];
        const mx = px + verts[(base + k) * 2];
        const my = py + verts[(base + k) * 2 + 1];
        // |m| = 2cos(a/2) for unit normals a radians apart, so the miter 1/cos(a/2) is 2/|m|.
        const lengthSquared = mx * mx + my * my;
        let offsetX: number;
        let offsetY: number;
        if (lengthSquared < 1e-12) {
            // The loop turns straight back on itself, as at a tip whose last edge was skipped:
            // carry on past the tip along the edge that arrives there.
            offsetX = -side * py * reach;
            offsetY = side * px * reach;
        } else {
            let scale = 2 / lengthSquared;
            if (lengthSquared * limit < 4) scale = ANTIALIAS_MAX_MITER / Math.sqrt(lengthSquared);
            offsetX = mx * scale * reach;
            offsetY = my * scale * reach;
        }
        const a = loop[k];
        verts[(base + k) * 2] = verts[a * 2] + offsetX;
        verts[(base + k) * 2 + 1] = verts[a * 2 + 1] + offsetY;
    }
}

// Every default lives in the unit square or unit circle at the origin; the canvas matrix is
// what places and sizes it. This is what makes `layout: polar` useful without the author
// spending scarce expression tokens on trigonometry.
export function defaultPosition(layout: number, u: number, v: number, out: Float32Array): void {
    switch (layout) {
        case LAYOUT_POLAR:
        case LAYOUT_FAN: {
            const angle = fr(u * TWO_PI);
            out[0] = fr(v * fr(Math.cos(angle)));
            out[1] = fr(v * fr(Math.sin(angle)));
            break;
        }
        case LAYOUT_RING: {
            const angle = fr(u * TWO_PI);
            const radius = fr(DEFAULT_RING_INNER_RADIUS + fr((1 - DEFAULT_RING_INNER_RADIUS) * v));
            out[0] = fr(radius * fr(Math.cos(angle)));
            out[1] = fr(radius * fr(Math.sin(angle)));
            break;
        }
        default:
            out[0] = u;
            out[1] = v;
            break;
    }
}

export function roundCapSegments(segments: number): number {
    const cap = Math.trunc(segments / 4);
    if (cap < MIN_ROUND_CAP_SEGMENTS) return MIN_ROUND_CAP_SEGMENTS;
    return Math.min(cap, MAX_ROUND_CAP_SEGMENTS);
}

const _f32 = new Float32Array(1);
const _i32 = new Int32Array(_f32.buffer);

/** Widen a 16-bit half to a float. The wire format is f16; everything above it is f32. */
export function halfToFloat(half: number): number {
    const sign = (half & 0x8000) << 16;
    const exponent = (half >> 10) & 0x1f;
    let mantissa = half & 0x3ff;
    let bits: number;
    if (exponent === 0) {
        if (mantissa === 0) {
            bits = sign;
        } else {
            let shift = 0;
            while ((mantissa & 0x400) === 0) { mantissa <<= 1; shift++; }
            mantissa &= 0x3ff;
            bits = sign | ((127 - 15 - shift) << 23) | (mantissa << 13);
        }
    } else if (exponent === 0x1f) {
        bits = sign | 0x7f800000 | (mantissa << 13);
    } else {
        bits = sign | ((exponent - 15 + 127) << 23) | (mantissa << 13);
    }
    _i32[0] = bits;
    return _f32[0];
}

// ── path flattening ─────────────────────────────────────────────────────────────────────

export const PATH_MOVE = 10, PATH_LINE = 11, PATH_QUAD = 12, PATH_CONIC = 13;
export const PATH_CUBIC = 14, PATH_CLOSE = 15, PATH_DONE = 16;
const PATH_CURVE_STEPS = 16;

export function pathNanId(v: number): number {
    _f32[0] = v;
    return _i32[0] & 0x3fffff;
}

export function isPathCommand(v: number): boolean {
    if (!Number.isNaN(v)) return false;
    const id = pathNanId(v);
    return id >= PATH_MOVE && id <= PATH_DONE;
}

/** Flatten a stored path into a polyline of x,y pairs.
 *
 * The layout is the one PathData writes: a NaN-tagged verb, then for every verb EXCEPT move
 * and close two PADDING floats, then the coordinates. The padding is easy to miss — skip it
 * only for `line` and a straight path still flattens plausibly while a curved one silently
 * reads its first control point out of the padding.
 */
export function flattenPath(data: Float32Array,
                            resolve: (v: number) => number): Float32Array<ArrayBuffer> {
    const out: number[] = [];
    let startX = 0, startY = 0, curX = 0, curY = 0, open = false;
    const push = (x: number, y: number) => {
        const n = out.length;
        if (n >= 2 && out[n - 2] === x && out[n - 1] === y) return;
        out.push(x, y);
    };

    let i = 0;
    const n = data.length;
    while (i < n) {
        if (!isPathCommand(data[i])) { i++; continue; }
        switch (pathNanId(data[i])) {
            case PATH_MOVE:
                i++;
                if (i + 1 < n) {
                    curX = startX = resolve(data[i]);
                    curY = startY = resolve(data[i + 1]);
                    push(curX, curY);
                    open = true;
                    i += 2;
                }
                break;
            case PATH_LINE:
                i += 3;                             // verb + 2 padding
                if (i + 1 < n) {
                    curX = resolve(data[i]);
                    curY = resolve(data[i + 1]);
                    push(curX, curY);
                    i += 2;
                }
                break;
            case PATH_QUAD:
                i += 3;
                if (i + 3 < n) {
                    const cx = resolve(data[i]), cy = resolve(data[i + 1]);
                    const x = resolve(data[i + 2]), y = resolve(data[i + 3]);
                    for (let s = 1; s <= PATH_CURVE_STEPS; s++) {
                        const t = s / PATH_CURVE_STEPS, mt = 1 - t;
                        push(mt * mt * curX + 2 * mt * t * cx + t * t * x,
                             mt * mt * curY + 2 * mt * t * cy + t * t * y);
                    }
                    curX = x; curY = y;
                    i += 4;
                }
                break;
            case PATH_CONIC:
                i += 3;
                if (i + 4 < n) {
                    const cx = resolve(data[i]), cy = resolve(data[i + 1]);
                    const x = resolve(data[i + 2]), y = resolve(data[i + 3]);
                    const w = resolve(data[i + 4]);
                    for (let s = 1; s <= PATH_CURVE_STEPS; s++) {
                        const t = s / PATH_CURVE_STEPS, mt = 1 - t;
                        const w0 = mt * mt, w1 = 2 * mt * t * w, w2 = t * t;
                        const denom = w0 + w1 + w2;
                        if (denom === 0) continue;
                        push((w0 * curX + w1 * cx + w2 * x) / denom,
                             (w0 * curY + w1 * cy + w2 * y) / denom);
                    }
                    curX = x; curY = y;
                    i += 5;
                }
                break;
            case PATH_CUBIC:
                i += 3;
                if (i + 5 < n) {
                    const c1x = resolve(data[i]), c1y = resolve(data[i + 1]);
                    const c2x = resolve(data[i + 2]), c2y = resolve(data[i + 3]);
                    const x = resolve(data[i + 4]), y = resolve(data[i + 5]);
                    for (let s = 1; s <= PATH_CURVE_STEPS; s++) {
                        const t = s / PATH_CURVE_STEPS, mt = 1 - t;
                        const a = mt * mt * mt, b = 3 * mt * mt * t;
                        const c = 3 * mt * t * t, d = t * t * t;
                        push(a * curX + b * c1x + c * c2x + d * x,
                             a * curY + b * c1y + c * c2y + d * y);
                    }
                    curX = x; curY = y;
                    i += 6;
                }
                break;
            case PATH_CLOSE:
                i++;
                if (open) push(startX, startY);
                curX = startX; curY = startY;
                break;
            case PATH_DONE:
            default:
                return new Float32Array(out);
        }
    }
    return new Float32Array(out);
}

/** Sample a flattened path at a fraction of arclength: out gets x, y, tangentX, tangentY. */
export function samplePolyline(poly: Float32Array, pointCount: number, fraction: number,
                               out: Float32Array): void {
    out[0] = 0; out[1] = 0; out[2] = 1; out[3] = 0;
    if (pointCount < 2) {
        if (pointCount === 1) { out[0] = poly[0]; out[1] = poly[1]; }
        return;
    }
    let total = 0;
    for (let i = 0; i + 1 < pointCount; i++) {
        const dx = poly[(i + 1) * 2] - poly[i * 2];
        const dy = poly[(i + 1) * 2 + 1] - poly[i * 2 + 1];
        total += Math.sqrt(dx * dx + dy * dy);
    }
    if (total <= 0) { out[0] = poly[0]; out[1] = poly[1]; return; }

    const target = Math.min(Math.max(fraction, 0), 1) * total;
    let walked = 0;
    for (let i = 0; i + 1 < pointCount; i++) {
        const x0 = poly[i * 2], y0 = poly[i * 2 + 1];
        const x1 = poly[(i + 1) * 2], y1 = poly[(i + 1) * 2 + 1];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len <= 0) continue;
        if (walked + len >= target || i + 2 === pointCount) {
            const t = Math.min(Math.max((target - walked) / len, 0), 1);
            out[0] = x0 + dx * t;
            out[1] = y0 + dy * t;
            out[2] = dx / len;
            out[3] = dy / len;
            return;
        }
        walked += len;
    }
}

/** A point on a round end cap: direction -1 at the strip's start, +1 at its end. */
export function roundCapPoint(sample: Float32Array, halfWidth: number, t: number, v: number,
                              direction: number, out: Float32Array): void {
    const tx = sample[2] * direction, ty = sample[3] * direction;
    const nx = -sample[3], ny = sample[2];
    const angle = (1 - t) * HALF_PI;
    const along = Math.sin(angle) * halfWidth;
    const across = Math.cos(angle) * halfWidth;
    const side = (v - 0.5) * 2;
    out[0] = sample[0] + tx * along + nx * across * side;
    out[1] = sample[1] + ty * along + ny * across * side;
}

/** A monotone cubic through the width control points.
 *
 * A plain Catmull-Rom would overshoot and bulge the ribbon past the widths the author gave;
 * the Fritsch-Carlson limiter keeps the fit monotone between samples.
 */
export class MonotonicSpline {
    private x: number[] = [];
    private y: number[] = [];
    private m: number[] = [];

    fit(xs: number[], ys: number[]): void {
        this.x = xs; this.y = ys;
        const n = xs.length;
        this.m = new Array(n).fill(0);
        if (n < 2) return;
        const d = new Array(n - 1).fill(0);
        for (let i = 0; i + 1 < n; i++) {
            const dx = xs[i + 1] - xs[i];
            d[i] = dx !== 0 ? (ys[i + 1] - ys[i]) / dx : 0;
        }
        this.m[0] = d[0];
        this.m[n - 1] = d[n - 2];
        for (let i = 1; i + 1 < n; i++) {
            this.m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) * 0.5;
        }
        for (let i = 0; i + 1 < n; i++) {
            if (d[i] === 0) { this.m[i] = 0; this.m[i + 1] = 0; continue; }
            const a = this.m[i] / d[i], b = this.m[i + 1] / d[i];
            const s = a * a + b * b;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                this.m[i] = t * a * d[i];
                this.m[i + 1] = t * b * d[i];
            }
        }
    }

    get isEmpty(): boolean { return this.x.length === 0; }

    at(x: number): number {
        const n = this.x.length;
        if (n === 0) return 0;
        if (n === 1 || x <= this.x[0]) return this.y[0];
        if (x >= this.x[n - 1]) return this.y[n - 1];
        let i = 0;
        while (i + 2 < n && x > this.x[i + 1]) i++;
        const h = this.x[i + 1] - this.x[i];
        if (h <= 0) return this.y[i];
        const t = (x - this.x[i]) / h, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * this.y[i] + (t3 - 2 * t2 + t) * h * this.m[i]
             + (-2 * t3 + 3 * t2) * this.y[i + 1] + (t3 - t2) * h * this.m[i + 1];
    }
}

// ── frame sampling and the matrix built from it ──────────────────────────────────────────

function bilinear(verts: Float32Array, uCount: number, i0: number, j0: number,
                  i1: number, j1: number, tu: number, tv: number, c: number): number {
    const v00 = verts[(j0 * uCount + i0) * 2 + c];
    const v10 = verts[(j0 * uCount + i1) * 2 + c];
    const v01 = verts[(j1 * uCount + i0) * 2 + c];
    const v11 = verts[(j1 * uCount + i1) * 2 + c];
    const top = v00 + (v10 - v00) * tu;
    const bottom = v01 + (v11 - v01) * tu;
    return top + (bottom - top) * tv;
}

export function sampleMeshPosition(layout: number, uCount: number, vCount: number,
                                   verts: Float32Array, u: number, v: number,
                                   out: Float32Array): void {
    const vc = verts.length / 2;
    if (vc === 0) { out[0] = 0; out[1] = 0; return; }

    // The layout's vertices may be followed by more: an antialiased mesh carries its skirt
    // after the body, and the skirt is no part of the surface a matrix is read from.
    if (layout === LAYOUT_FAN && uCount >= 1 && vc >= uCount + 1) {
        const uNorm = ((u % 1) + 1) % 1;
        const fu = uNorm * uCount;
        const i0 = Math.floor(fu) % uCount;
        const i1 = (i0 + 1) % uCount;
        const tu = fu - Math.floor(fu);
        const rimX = (1 - tu) * verts[(1 + i0) * 2] + tu * verts[(1 + i1) * 2];
        const rimY = (1 - tu) * verts[(1 + i0) * 2 + 1] + tu * verts[(1 + i1) * 2 + 1];
        const vClamp = Math.min(Math.max(v, 0), 1);
        out[0] = (1 - vClamp) * verts[0] + vClamp * rimX;
        out[1] = (1 - vClamp) * verts[1] + vClamp * rimY;
        return;
    }

    if (uCount >= 2 && vCount >= 2 && uCount * vCount <= vc) {
        let i0: number, i1: number, tu: number;
        if (wrapsU(layout)) {
            const uNorm = ((u % 1) + 1) % 1;
            const fu = uNorm * uCount;
            i0 = Math.floor(fu) % uCount;
            i1 = (i0 + 1) % uCount;
            tu = fu - Math.floor(fu);
        } else {
            const fu = Math.min(Math.max(u, 0), 1) * (uCount - 1);
            i0 = Math.floor(fu);
            i1 = Math.min(uCount - 1, i0 + 1);
            tu = fu - i0;
        }
        const fv = Math.min(Math.max(v, 0), 1) * (vCount - 1);
        const j0 = Math.floor(fv);
        const j1 = Math.min(vCount - 1, j0 + 1);
        const tv = fv - j0;
        out[0] = bilinear(verts, uCount, i0, j0, i1, j1, tu, tv, 0);
        out[1] = bilinear(verts, uCount, i0, j0, i1, j1, tu, tv, 1);
        return;
    }

    const nearest = Math.max(0, Math.min(vc - 1,
        Math.round(Math.min(Math.max(u, 0), 1) * (vc - 1))));
    out[0] = verts[nearest * 2];
    out[1] = verts[nearest * 2 + 1];
}

/** The local frame at (u, v): duX, duY, dvX, dvY, originX, originY. */
export function sampleFrame(layout: number, uCount: number, vCount: number,
                            verts: Float32Array, u: number, v: number,
                            out: Float32Array): boolean {
    if (verts.length < 2) return false;
    const uc = Math.max(2, uCount);
    const vc = Math.max(2, vCount);
    const wrap = wrapsU(layout);
    const du = 1 / (wrap ? uc : uc - 1);
    const dv = 1 / (vc - 1);

    const centre = new Float32Array(2), uPlus = new Float32Array(2);
    const uMinus = new Float32Array(2), vPlus = new Float32Array(2), vMinus = new Float32Array(2);
    sampleMeshPosition(layout, uCount, vCount, verts, u, v, centre);

    let uSpan: number;
    if (wrap) {
        sampleMeshPosition(layout, uCount, vCount, verts, u + du * 0.5, v, uPlus);
        sampleMeshPosition(layout, uCount, vCount, verts, u - du * 0.5, v, uMinus);
        uSpan = du;
    } else {
        const uHi = Math.min(1, u + du * 0.5), uLo = Math.max(0, u - du * 0.5);
        sampleMeshPosition(layout, uCount, vCount, verts, uHi, v, uPlus);
        sampleMeshPosition(layout, uCount, vCount, verts, uLo, v, uMinus);
        uSpan = uHi - uLo;
        if (uSpan <= 0) uSpan = du;
    }
    const vHi = Math.min(1, v + dv * 0.5), vLo = Math.max(0, v - dv * 0.5);
    sampleMeshPosition(layout, uCount, vCount, verts, u, vHi, vPlus);
    sampleMeshPosition(layout, uCount, vCount, verts, u, vLo, vMinus);
    let vSpan = vHi - vLo;
    if (vSpan <= 0) vSpan = dv;

    out[0] = (uPlus[0] - uMinus[0]) / uSpan;
    out[1] = (uPlus[1] - uMinus[1]) / uSpan;
    out[2] = (vPlus[0] - vMinus[0]) / vSpan;
    out[3] = (vPlus[1] - vMinus[1]) / vSpan;
    out[4] = centre[0];
    out[5] = centre[1];
    return true;
}

/** Turn a frame into a 2x3 affine: duX, duY, dvX, dvY, originX, originY.
 *
 * Degrades rather than producing a singular matrix: a flattened patch loses its scale, a
 * collapsed one its rotation too. Without this a folded cell would concat a non-invertible
 * matrix and take every later draw with it.
 */
export function buildMatrix(frame: Float32Array, flags: number, out: Float32Array): void {
    const duX = frame[0], duY = frame[1], dvX = frame[2], dvY = frame[3];
    const originX = frame[4], originY = frame[5];
    const duLength = Math.hypot(duX, duY);
    const dvLength = Math.hypot(dvX, dvY);
    const cross = duX * dvY - duY * dvX;

    let effective = flags;
    if (effective >= FLAG_FULL && Math.abs(cross) < DEGENERATE_EPSILON) effective = FLAG_SCALE;
    if (effective >= FLAG_SCALE
        && (duLength < DEGENERATE_EPSILON || dvLength < DEGENERATE_EPSILON)) {
        effective = FLAG_ROTATION;
    }
    if (effective >= FLAG_ROTATION && duLength < DEGENERATE_EPSILON) effective = FLAG_ORIGIN;

    switch (effective) {
        case FLAG_FULL:
            out[0] = duX; out[1] = duY; out[2] = dvX; out[3] = dvY;
            break;
        case FLAG_SCALE: {
            const ux = duX / duLength, uy = duY / duLength;
            const sign = cross < 0 ? -1 : 1;
            out[0] = ux * duLength; out[1] = uy * duLength;
            out[2] = -uy * dvLength * sign; out[3] = ux * dvLength * sign;
            break;
        }
        case FLAG_ROTATION: {
            const ux = duX / duLength, uy = duY / duLength;
            const sign = cross < 0 ? -1 : 1;
            out[0] = ux; out[1] = uy; out[2] = -uy * sign; out[3] = ux * sign;
            break;
        }
        case FLAG_ORIGIN:
        default:
            out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 1;
            break;
    }
    out[4] = originX;
    out[5] = originY;
}

export function clamp255(f: number): number {
    // In float32, as the reference's (int) (f * 255f + 0.5f): in double, 0.9 packs to 229
    // where the reference gets 230, so a channel on such a boundary came out one step dark.
    const i = Math.trunc(Math.fround(Math.fround(Math.fround(f) * 255) + 0.5));
    return i < 0 ? 0 : (i > 255 ? 255 : i);
}

export function packColor(a: number, r: number, g: number, b: number): number {
    return ((clamp255(a) << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) | 0;
}

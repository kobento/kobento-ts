// ComponentMeasure: result of a measure pass for a single component.
// Matches Java ComponentMeasure.java.

export class ComponentMeasure {
    mId: number;
    mX: number;
    mY: number;
    mW: number;
    mH: number;
    mVisibility: number;
    private mAllowsAnimation = true;

    // The constraints this component was last measured with in this pass (Java's measure
    // cache): a measure asking again with the same ones, or with its own measured size as
    // the fixed size on one axis, can keep the result.
    private mMinWidth = -1;
    private mMaxWidth = -1;
    private mMinHeight = -1;
    private mMaxHeight = -1;
    private mHasCache = false;

    setCachedConstraints(minWidth: number, maxWidth: number, minHeight: number, maxHeight: number): void {
        this.mMinWidth = minWidth;
        this.mMaxWidth = maxWidth;
        this.mMinHeight = minHeight;
        this.mMaxHeight = maxHeight;
        this.mHasCache = true;
    }

    clearCache(): void { this.mHasCache = false; }

    hasCachedConstraints(minWidth: number, maxWidth: number, minHeight: number, maxHeight: number): boolean {
        if (!this.mHasCache) return false;
        // 1. Exact match
        if (this.mMinWidth === minWidth && this.mMaxWidth === maxWidth
            && this.mMinHeight === minHeight && this.mMaxHeight === maxHeight) return true;
        // 2. The vertical positioning pass: the same width constraints, the height fixed to
        // the height measured last time.
        if (this.mMinWidth === minWidth && this.mMaxWidth === maxWidth
            && minHeight === this.mH && maxHeight === this.mH) return true;
        // 3. The horizontal positioning pass: the same height constraints, the width fixed to
        // the width measured last time.
        if (this.mMinHeight === minHeight && this.mMaxHeight === maxHeight
            && minWidth === this.mW && maxWidth === this.mW) return true;
        return false;
    }

    // Visibility constants — matches Java Component.Visibility encoding
    static readonly GONE = 0;
    static readonly VISIBLE = 1;
    static readonly INVISIBLE = 2;

    constructor(id: number, x: number, y: number, w: number, h: number,
                visibility = ComponentMeasure.VISIBLE) {
        this.mId = id;
        this.mX = x;
        this.mY = y;
        this.mW = w;
        this.mH = h;
        this.mVisibility = visibility;
    }

    getX(): number { return this.mX; }
    setX(value: number): void { this.mX = value; }
    getY(): number { return this.mY; }
    setY(value: number): void { this.mY = value; }
    getW(): number { return this.mW; }
    setW(value: number): void { this.mW = value; }
    getH(): number { return this.mH; }
    setH(value: number): void { this.mH = value; }

    getVisibility(): number { return this.mVisibility; }
    setVisibility(v: number): void { this.mVisibility = v; }

    getAllowsAnimation(): boolean { return this.mAllowsAnimation; }
    setAllowsAnimation(v: boolean): void { this.mAllowsAnimation = v; }

    copyFrom(m: ComponentMeasure): void {
        this.mX = m.mX; this.mY = m.mY;
        this.mW = m.mW; this.mH = m.mH;
        this.mVisibility = m.mVisibility;
    }

    same(m: ComponentMeasure): boolean {
        return this.mX === m.mX && this.mY === m.mY
            && this.mW === m.mW && this.mH === m.mH
            && this.mVisibility === m.mVisibility;
    }

    isGone(): boolean {
        if ((this.mVisibility >> 4) > 0) {
            return (this.mVisibility & 16) === 16;  // OVERRIDE_GONE
        }
        return this.mVisibility === ComponentMeasure.GONE;
    }

    isVisible(): boolean {
        if ((this.mVisibility >> 4) > 0) {
            return (this.mVisibility & 32) === 32;  // OVERRIDE_VISIBLE
        }
        return this.mVisibility === ComponentMeasure.VISIBLE;
    }

    isInvisible(): boolean {
        if ((this.mVisibility >> 4) > 0) {
            return (this.mVisibility & 64) === 64;  // OVERRIDE_INVISIBLE
        }
        return this.mVisibility === ComponentMeasure.INVISIBLE;
    }

    clearVisibilityOverride(): void {
        this.mVisibility = this.mVisibility & 15;
    }

    addVisibilityOverride(value: number): void {
        // Match Java: clear override first, then add
        let v = this.mVisibility & 15;
        v += value;
        if ((v & 128) === 128) {  // CLEAR_OVERRIDE
            v = v & 15;
        }
        this.mVisibility = v;
    }
}

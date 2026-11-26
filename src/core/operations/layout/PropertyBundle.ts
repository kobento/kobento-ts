// Property bundles (androidx 0d0f5ab0f6d, 7a96775051d, 70ac8c200f4; experimental, androidx
// profile): integer properties attached to a component, and a lookup that reads one of them into
// an integer variable.
//
//   MODIFIER_PROPERTY_BUNDLE (95)  INT version (0), INT bundleId, INT parentBundleId, INT count,
//                                  count x (INT propertyId, INT valueId)  - at most 256 entries;
//                                  each value is the id of an integer variable (or expression)
//   PROPERTY_BUNDLE_LOOKUP (96)    INT version (0), INT valueId (declared), INT componentId,
//                                  INT propertyId, INT defaultValue
//
// A lookup names a component by id, or -1 for the one it is in (bound at inflate, as Java's
// Component / LayoutComponent.inflate do; a lookup in a layout's content names the content's id
// and is bound to the layout). A content (LayoutComponentContent, CanvasContent) reads its
// parent's bundle. Missing component, bundle or property: the default. The lookup listens to the
// property's variable, so it follows it.

import { Operation } from '../../Operation';
import type { WireBuffer } from '../../WireBuffer';
import type { RemoteContext } from '../../RemoteContext';
import type { VariableSupport } from '../../VariableSupport';

const MAX_ENTRIES = 256;   // Limits.MAX_PROPERTY_BUNDLE_ENTRIES

export class PropertyBundleModifier extends Operation {
    static readonly OP_CODE = 95;
    readonly mBundleId: number;
    readonly mParentBundleId: number;
    /** propertyId -> the id of the integer variable holding its value. */
    readonly mProperties: Map<number, number>;

    constructor(bundleId: number, parentBundleId: number, properties: Map<number, number>) {
        super();
        this.mBundleId = bundleId;
        this.mParentBundleId = parentBundleId;
        this.mProperties = properties;
    }
    hasProperty(propertyId: number): boolean { return this.mProperties.has(propertyId); }
    getValue(propertyId: number, defaultValue: number): number {
        const v = this.mProperties.get(propertyId);
        return v === undefined ? defaultValue : v;
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* attached to its component at inflate */ }
    deepToString(indent: string): string {
        return `${indent}PropertyBundleModifier(bundleId=${this.mBundleId}, parentBundleId=${this.mParentBundleId}, properties=${JSON.stringify([...this.mProperties])})`;
    }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const version = buffer.readInt();
        if (version !== 0) throw new Error(`Unsupported PropertyBundleModifierOperation version: ${version}`);
        const bundleId = buffer.readInt();
        const parentBundleId = buffer.readInt();
        const count = buffer.readInt();
        if (count < 0 || count > MAX_ENTRIES) throw new Error(`Invalid PropertyBundle entry count: ${count}`);
        const properties = new Map<number, number>();
        for (let i = 0; i < count; i++) {
            const propertyId = buffer.readInt();
            properties.set(propertyId, buffer.readId());
        }
        operations.push(new PropertyBundleModifier(bundleId, parentBundleId, properties));
    }
}

/** What a lookup needs of a component (Component, without importing it here). */
interface BundleHolder {
    getComponentId(): number;
    getParent(): BundleHolder | null;
    getPropertyBundle(): PropertyBundleModifier | null;
    /** LayoutComponentContent and CanvasContent: their bundle is their parent's. */
    readonly isContentWrapper?: boolean;
}

export class PropertyBundleLookup extends Operation implements VariableSupport {
    static readonly OP_CODE = 96;
    /** PropertyBundleLookupOperation.SELF_COMPONENT_ID */
    static readonly SELF = -1;
    private mValueId: number;
    private mComponentId: number;
    readonly mPropertyId: number;
    readonly mDefaultValue: number;
    private mResolved = false;
    private mSourceVariableId = -1;
    private mResolvedValue: number;

    constructor(valueId: number, componentId: number, propertyId: number, defaultValue: number) {
        super();
        this.mValueId = valueId;
        this.mComponentId = componentId;
        this.mPropertyId = propertyId;
        this.mDefaultValue = defaultValue;
        this.mResolvedValue = defaultValue;
    }
    getId(): number { return this.mValueId; }
    getComponentId(): number { return this.mComponentId; }
    setComponentId(id: number): void { this.mComponentId = id; this.mResolved = false; }

    /** Which variable holds the property now (resolveSource). */
    private resolveSource(context: RemoteContext): void {
        const doc: any = context.getDocument();
        const root = doc?.mRootLayoutComponent ?? null;
        let c: BundleHolder | null = root ? root.getComponent(this.mComponentId) : null;
        const last: BundleHolder | null = (context as any).mLastComponent ?? null;
        if (c === null && last !== null
            && (this.mComponentId === PropertyBundleLookup.SELF || last.getComponentId() === this.mComponentId)) {
            c = last;
        }
        if (c !== null && c.isContentWrapper) c = c.getParent();
        const bundle = c !== null && typeof c.getPropertyBundle === 'function' ? c.getPropertyBundle() : null;
        this.mSourceVariableId = bundle !== null && bundle.hasProperty(this.mPropertyId)
            ? bundle.getValue(this.mPropertyId, -1) : -1;
        // Java resolves again on every update while a document is there; the tree does not
        // change once inflated, so once is enough here, as long as the layout tree exists.
        this.mResolved = root !== null;
    }

    registerListening(context: RemoteContext): void {
        this.mResolved = false;
        this.resolveSource(context);
        if (this.mSourceVariableId !== -1) context.listensTo(this.mSourceVariableId, this);
    }

    updateVariables(context: RemoteContext): void {
        if (!this.mResolved) this.resolveSource(context);
        this.mResolvedValue = this.mSourceVariableId !== -1
            ? context.getInteger(this.mSourceVariableId) : this.mDefaultValue;
    }

    apply(context: RemoteContext): void {
        this.updateVariables(context);
        context.loadInteger(this.mValueId, this.mResolvedValue);
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    deepToString(indent: string): string {
        return `${indent}PROPERTY_BUNDLE_LOOKUP valueId=${this.mValueId} componentId=${this.mComponentId} propertyId=${this.mPropertyId} defaultValue=${this.mDefaultValue}`;
    }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const version = buffer.readInt();
        if (version !== 0) throw new Error(`Unsupported PropertyBundleLookupOperation version: ${version}`);
        const valueId = buffer.declareId();
        const componentId = buffer.readId();
        const propertyId = buffer.readInt();
        const defaultValue = buffer.readInt();
        operations.push(new PropertyBundleLookup(valueId, componentId, propertyId, defaultValue));
    }
}

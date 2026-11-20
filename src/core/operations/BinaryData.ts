// BINARY_DATA (41): an opaque blob stored in the document under an id.
//
// Ported from androidx remote-core BinaryData.java (2026-11). Wire format: id, type, flags,
// then the bytes as a length-prefixed buffer of at most MAX_BINARY_DATA. `type` says what the
// bytes are; `flags` is reserved for the type and 0 today. The blob is registered with
// putObject so other operations can find it by id: an embedded document (LAYOUT_RC_DOC) whose
// url id names a TYPE_RC_DOC blob plays those bytes rather than asking the host to resolve the
// url, which lets a parent carry its children in its own buffer.

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';

export class BinaryData extends Operation {
    static readonly OP_CODE = 41;
    /** Uninterpreted bytes. */
    static readonly TYPE_RAW = 0;
    /** A complete RemoteCompose document (header included), playable on its own. */
    static readonly TYPE_RC_DOC = 1;
    /** Limits.MAX_BINARY_DATA. */
    static readonly MAX_BINARY_DATA = 100_000;

    constructor(readonly mId: number, readonly mType: number, readonly mFlags: number,
                readonly mData: Uint8Array) {
        super();
    }

    getId(): number { return this.mId; }
    getType(): number { return this.mType; }
    getFlags(): number { return this.mFlags; }
    getData(): Uint8Array { return this.mData; }

    // Players read documents; they never write them. Stubbed as elsewhere in this tree.
    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.putObject(this.mId, this);
    }

    deepToString(indent: string): string {
        return indent + 'BinaryData id=' + this.mId + ' type=' + this.mType
             + ' length=' + this.mData.length;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readId();
        const type = buffer.readInt();
        const flags = buffer.readInt();
        // The reference refuses a larger blob, so a document carrying one fails here too.
        const data = buffer.readBufferMax(BinaryData.MAX_BINARY_DATA);
        operations.push(new BinaryData(id, type, flags, data));
    }
}

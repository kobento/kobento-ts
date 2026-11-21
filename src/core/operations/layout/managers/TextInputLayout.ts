// TextInputLayout (LAYOUT_TEXT_INPUT, 60): a box whose content shows a user-editable string.
// Port of Java operations/layout/managers/TextInputLayout.java (androidx 7f6f9150bc8).
//
// The layout declares a string (textId) as editable and carries the editor's options as a sparse
// attribute list (count, then byte id / int value pairs, defaults omitted), like CoreText. Its
// content is free: typically a text bound to the same string, maybe with a label, an icon or a
// border. A click the content did not handle starts a TextInputSession when the player installed
// a TextInputSupport on its PaintContext; while editing, the text component bound to the string
// (if any) is not painted, the host's editor shows the text. An empty string shows the hint.
// Without a support the layout is a box.

import { BoxLayout } from './BoxLayout';
import { CoreText } from './CoreText';
import { TextLayout } from './TextLayout';
import { LayoutComponent } from '../LayoutComponent';
import { PaintBundle } from '../../paint/PaintBundle';
import { TextInputSession } from '../../../TextInput';
import type { TextInputSupport } from '../../../TextInput';
import type { Component } from '../Component';
import type { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import type { RemoteContext } from '../../../RemoteContext';
import { PaintContext } from '../../../PaintContext';
import type { VariableSupport } from '../../../VariableSupport';

// CoreText's TEXT_ALIGN_* values
const TEXT_ALIGN_RIGHT = 2;
const TEXT_ALIGN_CENTER = 3;
const TEXT_ALIGN_END = 6;

export class TextInputLayout extends BoxLayout implements VariableSupport {
    static readonly OP_CODE = 60;

    // Keyboard types (Compose KeyboardType's values)
    static readonly KEYBOARD_UNSPECIFIED = 0;
    static readonly KEYBOARD_TEXT = 1;
    static readonly KEYBOARD_ASCII = 2;
    static readonly KEYBOARD_NUMBER = 3;
    static readonly KEYBOARD_PHONE = 4;
    static readonly KEYBOARD_URI = 5;
    static readonly KEYBOARD_EMAIL = 6;
    static readonly KEYBOARD_PASSWORD = 7;
    static readonly KEYBOARD_NUMBER_PASSWORD = 8;
    static readonly KEYBOARD_DECIMAL = 9;
    // IME actions (Compose ImeAction's values)
    static readonly IME_ACTION_NONE = 0;
    static readonly IME_ACTION_DEFAULT = 1;
    static readonly IME_ACTION_GO = 2;
    static readonly IME_ACTION_SEARCH = 3;
    static readonly IME_ACTION_SEND = 4;
    static readonly IME_ACTION_PREVIOUS = 5;
    static readonly IME_ACTION_NEXT = 6;
    static readonly IME_ACTION_DONE = 7;
    // Input flags
    static readonly FLAG_SINGLE_LINE = 1;
    static readonly FLAG_COMMIT_ON_DONE = 1 << 1;
    static readonly FLAG_AUTO_CORRECT = 1 << 2;
    static readonly FLAG_CAPITALIZE_CHARACTERS = 1 << 3;
    static readonly FLAG_CAPITALIZE_WORDS = 1 << 4;
    static readonly FLAG_CAPITALIZE_SENTENCES = 1 << 5;
    // Input filters, applied by the editor before a keystroke reaches the string
    static readonly FILTER_NONE = 0;
    static readonly FILTER_DIGITS = 1;
    static readonly FILTER_DECIMAL = 2;
    static readonly FILTER_ALPHANUMERIC = 3;
    static readonly FILTER_HEXADECIMAL = 4;
    // Content types: what the string holds, for autofill and keyboard suggestions
    static readonly CONTENT_TYPE_NONE = 0;
    static readonly CONTENT_TYPE_PERSON_NAME = 1;
    static readonly CONTENT_TYPE_PERSON_FIRST_NAME = 2;
    static readonly CONTENT_TYPE_PERSON_LAST_NAME = 3;
    static readonly CONTENT_TYPE_EMAIL_ADDRESS = 4;
    static readonly CONTENT_TYPE_PHONE_NUMBER = 5;
    static readonly CONTENT_TYPE_USERNAME = 6;
    static readonly CONTENT_TYPE_PASSWORD = 7;
    static readonly CONTENT_TYPE_NEW_PASSWORD = 8;
    static readonly CONTENT_TYPE_ONE_TIME_CODE = 9;
    static readonly CONTENT_TYPE_POSTAL_ADDRESS = 10;
    static readonly CONTENT_TYPE_POSTAL_CODE = 11;
    static readonly CONTENT_TYPE_CREDIT_CARD_NUMBER = 12;
    static readonly CONTENT_TYPE_CREDIT_CARD_EXPIRATION_DATE = 13;
    static readonly CONTENT_TYPE_CREDIT_CARD_SECURITY_CODE = 14;

    // Sparse attribute ids (all INT on the wire)
    static readonly P_KEYBOARD_TYPE = 1;
    static readonly P_IME_ACTION = 2;
    static readonly P_INPUT_FLAGS = 3;
    static readonly P_MAX_LENGTH = 4;
    static readonly P_FILTER = 5;
    static readonly P_HINT_ID = 6;
    static readonly P_CONTENT_TYPE = 7;

    /** Opacity of the hint relative to the text colour, in percent. */
    private static readonly HINT_ALPHA_PERCENT = 45;
    private static readonly DEFAULT_FONT_SIZE = 36;
    private static readonly DEFAULT_FONT_WEIGHT = 400;

    private mEditing = false;
    private mSession: TextInputSession | null = null;
    private mTextComponent: CoreText | null = null;
    private readonly mHintPaint = new PaintBundle();
    private readonly mHintBounds = new Float32Array(4);

    constructor(componentId: number, animationId: number,
                readonly mTextId: number, readonly mKeyboardType: number, readonly mImeAction: number,
                readonly mInputFlags: number, readonly mMaxLength: number, readonly mFilter: number,
                readonly mHintId: number, readonly mContentType: number) {
        super(componentId, animationId, BoxLayout.START, BoxLayout.TOP);
    }

    override isVariableSupportComponent(): boolean { return true; }

    // ── Attributes ──────────────────────────────────────────────────────────────────────────
    getTextId(): number { return this.mTextId; }
    getKeyboardType(): number { return this.mKeyboardType; }
    getImeAction(): number { return this.mImeAction; }
    getInputFlags(): number { return this.mInputFlags; }
    hasInputFlag(flag: number): boolean { return (this.mInputFlags & flag) !== 0; }
    getMaxLength(): number { return this.mMaxLength; }
    getFilter(): number { return this.mFilter; }
    getHintId(): number { return this.mHintId; }
    getContentType(): number { return this.mContentType; }

    /** True for the keyboards that make the field secure (masked, single line, no suggestions). */
    isPassword(): boolean {
        return this.mKeyboardType === TextInputLayout.KEYBOARD_PASSWORD
            || this.mKeyboardType === TextInputLayout.KEYBOARD_NUMBER_PASSWORD;
    }

    override inflate(): void {
        super.inflate();
        // The content is inflated by super.inflate(): the lookup is complete here.
        this.mTextComponent = TextInputLayout.findTextComponent(this, this.mTextId);
    }

    /**
     * The text of the content showing the edited string, if any: the first CoreText bound to
     * textId, depth first, not looking into a nested text input (Java: a TextLayout, a
     * different class there, never matches). Resolved once at inflation.
     */
    getTextComponent(): CoreText | null { return this.mTextComponent; }

    private static findTextComponent(layout: LayoutComponent, textId: number): CoreText | null {
        for (const child of layout.mChildrenComponents) {
            if (child instanceof CoreText && !(child instanceof TextLayout) && child.getTextId() === textId) {
                return child;
            }
            if (child instanceof LayoutComponent && !(child instanceof TextInputLayout)) {
                const found = TextInputLayout.findTextComponent(child, textId);
                if (found) return found;
            }
        }
        return null;
    }

    // ── Editing lifecycle ───────────────────────────────────────────────────────────────────
    isEditing(): boolean { return this.mEditing; }
    getSession(): TextInputSession | null { return this.mSession; }

    override onClick(context: RemoteContext, doc: any, x: number, y: number): boolean {
        // The content handles the click first (a clear button in the field).
        if (super.onClick(context, doc, x, y)) return true;
        if (!this.isVisible()) return false;
        // (Coordinates are the parent's content's, as LayoutComponent.onClick takes them.)
        if (!(x >= this.mX && x <= this.mX + this.mWidth &&
              y >= this.mY && y <= this.mY + this.mHeight)) return false;
        const support = TextInputLayout.support(context);
        if (!support) return false;
        this.startTextInput(context, support);
        return true;
    }

    /** Starts an editing session with the host support, unless one is active already. */
    startTextInput(context: RemoteContext, support: TextInputSupport): void {
        if (this.mSession && this.mSession.isActive()) return;
        this.mSession = new TextInputSession(context, this);
        this.mEditing = true;
        support.startTextInput(this.mSession);
        context.needsRepaint();
    }

    /** Ends the session from the document's side (it is unloaded): the host drops its editor. */
    stopTextInput(context: RemoteContext): void {
        const session = this.mSession;
        if (!session || !session.isActive()) return;
        TextInputLayout.support(context)?.stopTextInput(session);
        session.end();
    }

    /** Called by TextInputSession.end(): the content paints its text again. */
    onSessionEnded(context: RemoteContext, session: TextInputSession): void {
        if (this.mSession !== session) return;
        this.mSession = null;
        this.mEditing = false;
        context.needsRepaint();
    }

    private static support(context: RemoteContext): TextInputSupport | null {
        return context.getPaintContext()?.getTextInputSupport() ?? null;
    }

    // ── Variables ───────────────────────────────────────────────────────────────────────────
    registerListening(context: RemoteContext): void {
        context.listensTo(this.mTextId, this);
        if (this.mHintId !== 0) context.listensTo(this.mHintId, this);
    }

    updateVariables(_context: RemoteContext): void { /* the text is read live */ }

    // ── Painting ────────────────────────────────────────────────────────────────────────────
    override paintingComponent(paintContext: PaintContext): void {
        const session = this.mSession;
        if (session && session.isActive() && session.updateBounds()) {
            // Keep the host's editor on the text when it moved (scroll, relayout).
            TextInputLayout.support(paintContext.getContext())?.updateTextInputBounds(session);
        }
        const text = this.mTextComponent;
        if (this.mEditing && text) {
            // The editor shows the text: paint everything but the text component, which may be
            // nested anywhere in the content (a row with an icon).
            const parent = text.getParent();
            const siblings = parent instanceof LayoutComponent ? parent.mChildrenComponents : null;
            const index = siblings ? siblings.indexOf(text) : -1;
            if (!siblings || index < 0) {
                super.paintingComponent(paintContext);
                return;
            }
            siblings.splice(index, 1);
            try {
                super.paintingComponent(paintContext);
            } finally {
                siblings.splice(index, 0, text);
            }
            return;
        }
        super.paintingComponent(paintContext);
        if (!this.mEditing && this.mHintId !== 0) {
            const value = paintContext.getContext().getText(this.mTextId);
            if (!value) this.paintHint(paintContext, text);
        }
    }

    /**
     * Paints the hint in place of the empty text: at the text component's content origin, in its
     * style at 45% of its alpha, aligned as it is; else at the layout's content origin.
     */
    private paintHint(paintContext: PaintContext, text: CoreText | null): void {
        const hint = paintContext.getContext().getText(this.mHintId);
        if (!hint) return;
        const length = hint.length;
        let x = this.mX + this.mPaddingLeft;
        let y = this.mY + this.mPaddingTop;
        let contentW = this.mWidth - this.mPaddingLeft - this.mPaddingRight;
        let textColor = 0xFF000000 | 0;
        let fontSize = TextInputLayout.DEFAULT_FONT_SIZE;
        let weight = TextInputLayout.DEFAULT_FONT_WEIGHT;
        let italic = false;
        let align = 0;
        if (text) {
            // The text's place in this layout's content. Java adds only the text's own x/y
            // (right for a direct child); for a text nested deeper (in a row with an icon) the
            // intermediate layouts' positions and paddings count too.
            let p: Component | null = text.getParent();
            while (p && p !== this) {
                const lc = p as LayoutComponent;
                x += p.mX + (lc.mPaddingLeft ?? 0);
                y += p.mY + (lc.mPaddingTop ?? 0);
                p = p.getParent();
            }
            x += text.mX + text.mPaddingLeft;
            y += text.mY + text.mPaddingTop;
            contentW = text.mWidth - text.mPaddingLeft - text.mPaddingRight;
            textColor = text.getColorValue();
            fontSize = text.getFontSizeValue();
            weight = text.getFontWeightValue();
            italic = text.getFontStyle() === 1;
            align = text.getTextAlignValue();
        }
        paintContext.save();
        paintContext.translate(x, y);
        paintContext.savePaint();
        const alpha = Math.floor(((textColor >>> 24) * TextInputLayout.HINT_ALPHA_PERCENT) / 100);
        this.mHintPaint.reset();
        this.mHintPaint.setStyle(PaintBundle.FILL);
        this.mHintPaint.setColor(((alpha << 24) | (textColor & 0x00FFFFFF)) | 0);
        this.mHintPaint.setTextSize(fontSize);
        this.mHintPaint.setTextStyle(0, Math.round(weight), italic);
        paintContext.replacePaint(this.mHintPaint);
        // The font's height, as CoreText measures the text it stands for: the hint's baseline is
        // then the text's, and where the editor's caret and placeholder appear when it opens.
        // (Java measures the ink box here, so its hint sits a cap height down instead of an
        // ascent, a few pixels higher than the text; on the web that jumped as editing began.)
        paintContext.getTextBounds(this.mHintId, 0, length, PaintContext.TEXT_MEASURE_FONT_HEIGHT, this.mHintBounds);
        const hintWidth = this.mHintBounds[2] - this.mHintBounds[0];
        const px = align === TEXT_ALIGN_CENTER ? (contentW - hintWidth) / 2
            : align === TEXT_ALIGN_RIGHT || align === TEXT_ALIGN_END ? contentW - hintWidth : 0;
        paintContext.drawTextRun(this.mHintId, 0, length, 0, 0, px - this.mHintBounds[0], -this.mHintBounds[1], false);
        paintContext.restorePaint();
        paintContext.restore();
    }

    // ── Serialization ───────────────────────────────────────────────────────────────────────
    override write(buffer: WireBuffer): void {
        const T = TextInputLayout;
        buffer.start(T.OP_CODE);
        buffer.writeInt(this.getComponentId());
        buffer.writeInt(this.mAnimationId);
        buffer.writeInt(this.mTextId);
        const attrs: [number, number, number][] = [
            [T.P_KEYBOARD_TYPE, this.mKeyboardType, T.KEYBOARD_UNSPECIFIED],
            [T.P_IME_ACTION, this.mImeAction, T.IME_ACTION_NONE],
            [T.P_INPUT_FLAGS, this.mInputFlags, 0],
            [T.P_MAX_LENGTH, this.mMaxLength, 0],
            [T.P_FILTER, this.mFilter, T.FILTER_NONE],
            [T.P_HINT_ID, this.mHintId, 0],
            [T.P_CONTENT_TYPE, this.mContentType, T.CONTENT_TYPE_NONE],
        ].filter(([, v, d]) => v !== d) as [number, number, number][];
        buffer.writeShort(attrs.length);
        for (const [id, v] of attrs) {
            buffer.writeByte(id);
            buffer.writeInt(v);
        }
    }

    override deepToString(indent: string): string {
        return `${indent}TextInputLayout(${this.getComponentId()}, textId=${this.mTextId})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const T = TextInputLayout;
        const componentId = buffer.declareId();
        const animationId = buffer.declareId();
        const textId = buffer.readId();
        const count = buffer.readShort();
        const a = [T.KEYBOARD_UNSPECIFIED, T.IME_ACTION_NONE, 0, 0, T.FILTER_NONE, 0, T.CONTENT_TYPE_NONE];
        const remap = (buffer as any).getRemapContext?.();
        for (let i = 0; i < count; i++) {
            const id = buffer.readByte();
            if (id < T.P_KEYBOARD_TYPE || id > T.P_CONTENT_TYPE) {
                // Every attribute is an INT so far; a reader cannot size an unknown one.
                throw new Error(`TextInputLayout: unknown attribute id ${id}`);
            }
            const value = buffer.readInt();
            // The hint is a string id: inside a pattern it goes through the macro remapping.
            a[id - 1] = id === T.P_HINT_ID && remap ? remap.resolveId(value) : value;
        }
        operations.push(new TextInputLayout(componentId, animationId, textId,
            a[0], a[1], a[2], a[3], a[4], a[5], a[6]));
    }
}

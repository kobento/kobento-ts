// Text input (androidx 7f6f9150bc8): a TextInputLayout (LAYOUT_TEXT_INPUT) declares a string
// editable; when clicked it opens a host editor, if the player installed a TextInputSupport on
// its PaintContext. Without one the layout is a box and its content shows the text as usual.

import type { RemoteContext } from './RemoteContext';
import type { Component } from './operations/layout/Component';
import type { CoreText } from './operations/layout/managers/CoreText';
import type { TextInputLayout } from './operations/layout/managers/TextInputLayout';

/**
 * Host-side support for editing document strings (Java TextInputSupport). The host presents an
 * editor over the session's bounds, writes edits back with session.setText(), and calls
 * session.end() once the editor is dismissed.
 */
export interface TextInputSupport {
    /**
     * Starts editing: present an editor at session.getBounds(), configured from
     * session.getLayout() and styled from session.getTextComponent() when there is one.
     */
    startTextInput(session: TextInputSession): void;
    /** The edited text moved or resized (scroll, relayout): move the editor. */
    updateTextInputBounds(session: TextInputSession): void;
    /** The document ends the session itself (unloaded): drop the editor; end() need not be called. */
    stopTextInput(session: TextInputSession): void;
}

/** One editing session of a TextInputLayout's string (Java TextInputSession). */
export class TextInputSession {
    private readonly mBounds = [0, 0, 0, 0];
    private readonly mTextComponent: CoreText | null;
    private mActive = true;

    constructor(private readonly mContext: RemoteContext,
                private readonly mLayout: TextInputLayout) {
        this.mTextComponent = mLayout.getTextComponent();
        this.updateBounds();
    }

    getComponentId(): number { return this.mLayout.getComponentId(); }
    getComponent(): Component { return this.mLayout; }
    /** The edited layout: keyboard type, IME action, flags, limits, hint, content type. */
    getLayout(): TextInputLayout { return this.mLayout; }
    /** The text showing the edited string in the layout's content, to style the editor; or null. */
    getTextComponent(): CoreText | null { return this.mTextComponent; }
    getContext(): RemoteContext { return this.mContext; }

    /**
     * The bounds the editor covers relative to the document root, [x, y, width, height] in
     * document pixels: the text component's when there is one, else the layout's.
     */
    getBounds(): number[] { return this.mBounds; }

    /** The edited string's current value. */
    getText(): string { return this.mContext.getText(this.mLayout.getTextId()) ?? ''; }

    /** Writes a new value of the string: every binding on it updates, and a repaint is asked for. */
    setText(text: string): void {
        if (!this.mActive) return;
        this.mContext.loadText(this.mLayout.getTextId(), text);
        this.mContext.needsRepaint();
    }

    /** The placeholder shown when the text is empty, or null if none was declared. */
    getHint(): string | null {
        const id = this.mLayout.getHintId();
        return id !== 0 ? this.mContext.getText(id) : null;
    }

    isActive(): boolean { return this.mActive; }

    /** Ends the session (the host dismissed its editor): the content paints its text again. */
    end(): void {
        if (!this.mActive) return;
        this.mActive = false;
        this.mLayout.onSessionEnded(this.mContext, this);
    }

    /** Recomputes getBounds() from the target's current place; true when they changed. */
    updateBounds(): boolean {
        const [x, y, w, h] = this.mBounds;
        // The target's own box (Java getLocationInWindow(forSelf)): a layout component's
        // location here is its content's, inside its padding, so the padding comes back off.
        const target: Component = this.mTextComponent ?? this.mLayout;
        const t = target as any;
        const loc = target.getLocationInWindow();
        this.mBounds[0] = loc[0] - (t.mPaddingLeft ?? 0);
        this.mBounds[1] = loc[1] - (t.mPaddingTop ?? 0);
        this.mBounds[2] = target.getWidth();
        this.mBounds[3] = target.getHeight();
        return x !== this.mBounds[0] || y !== this.mBounds[1] || w !== this.mBounds[2] || h !== this.mBounds[3];
    }
}

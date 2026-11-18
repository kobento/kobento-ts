// Text input (androidx CL 4451608): a component whose string is declared editable by a
// MODIFIER_TEXT_INPUT (TextInputModifier) opens a host editor when clicked, if the player
// installed a TextInputSupport on its PaintContext. Without one the modifier is inert and the
// component renders its text as usual.

import type { RemoteContext } from './RemoteContext';
import type { Component } from './operations/layout/Component';
import type { TextInputModifier } from './operations/layout/modifiers/ModifierOperations';

/**
 * Host-side support for editing document strings (Java TextInputSupport). The host presents an
 * editor over the session's bounds, writes edits back with session.setText(), and calls
 * session.end() once the editor is dismissed.
 */
export interface TextInputSupport {
    /** Starts editing: present an editor at session.getBounds(), configured from session.getOperation(). */
    startTextInput(session: TextInputSession): void;
    /** The edited component moved or resized (scroll, relayout): move the editor. */
    updateTextInputBounds(session: TextInputSession): void;
    /** The document ends the session itself (unloaded): drop the editor; end() need not be called. */
    stopTextInput(session: TextInputSession): void;
}

/** One editing session of a component's string (Java TextInputSession). */
export class TextInputSession {
    private readonly mBounds = [0, 0, 0, 0];
    private mActive = true;

    constructor(private readonly mContext: RemoteContext,
                private readonly mComponent: Component,
                private readonly mOperation: TextInputModifier) {
        this.updateBounds();
    }

    getComponentId(): number { return this.mComponent.getComponentId(); }
    getComponent(): Component { return this.mComponent; }
    getOperation(): TextInputModifier { return this.mOperation; }
    getContext(): RemoteContext { return this.mContext; }

    /** The edited component's bounds relative to the document root: [x, y, width, height], document pixels. */
    getBounds(): number[] { return this.mBounds; }

    /** The edited string's current value. */
    getText(): string { return this.mContext.getText(this.mOperation.getTextId()) ?? ''; }

    /** Writes a new value of the string: every binding on it updates, and a repaint is asked for. */
    setText(text: string): void {
        if (!this.mActive) return;
        this.mContext.loadText(this.mOperation.getTextId(), text);
        this.mContext.needsRepaint();
    }

    /** The placeholder shown when the text is empty, or null if none was declared. */
    getHint(): string | null {
        const id = this.mOperation.getHintId();
        return id !== 0 ? this.mContext.getText(id) : null;
    }

    isActive(): boolean { return this.mActive; }

    /** Ends the session (the host dismissed its editor): the component draws its text again. */
    end(): void {
        if (!this.mActive) return;
        this.mActive = false;
        this.mOperation.onSessionEnded(this.mContext, this);
    }

    /** Recomputes getBounds() from the component's current place; true when they changed. */
    updateBounds(): boolean {
        const [x, y, w, h] = this.mBounds;
        // The component's own box (Java getLocationInWindow(forSelf)): a layout component's
        // location here is its content's, inside its padding, so the padding comes back off.
        const c = this.mComponent as any;
        const loc = this.mComponent.getLocationInWindow();
        this.mBounds[0] = loc[0] - (c.mPaddingLeft ?? 0);
        this.mBounds[1] = loc[1] - (c.mPaddingTop ?? 0);
        this.mBounds[2] = this.mComponent.getWidth();
        this.mBounds[3] = this.mComponent.getHeight();
        return x !== this.mBounds[0] || y !== this.mBounds[1] || w !== this.mBounds[2] || h !== this.mBounds[3];
    }
}

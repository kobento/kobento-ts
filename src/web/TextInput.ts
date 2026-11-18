// The web player's text input (androidx CL 4445990, the View player's AndroidTextInputSupport
// on the web): an <input> (single line) or <textarea> placed over the edited component, styled
// from its text, writing edits back into the document's string on every keystroke (or on Enter
// with FLAG_COMMIT_ON_DONE). It is dismissed on Enter in a single-line field, on Escape, when it
// loses focus (a click elsewhere) or when the document goes away.

import type { TextInputSession, TextInputSupport } from '../core/TextInput';
import { TextInputModifier } from '../core/operations/layout/modifiers/ModifierOperations';

/** Maps document pixels to page (CSS, viewport) pixels: the player knows its canvas and transform. */
export interface DocumentToPage {
    /** [left, top, width, height] in viewport CSS pixels for a rectangle in document pixels. */
    rect(x: number, y: number, w: number, h: number): [number, number, number, number];
    /** CSS pixels per document pixel. */
    scale(): number;
    /** Asks the player for a frame (the edited string changed, or the editor closed). */
    repaint(): void;
}

const T = TextInputModifier;

export class WebTextInputSupport implements TextInputSupport {
    private editor: HTMLInputElement | HTMLTextAreaElement | null = null;
    private session: TextInputSession | null = null;
    private dismissing = false;
    private readonly onViewport = () => { if (this.session) this.place(this.session); };

    constructor(private readonly page: DocumentToPage) {}

    /** True while an editor is shown. */
    isEditing(): boolean { return !!this.session && this.session.isActive(); }

    startTextInput(session: TextInputSession): void {
        this.dismiss(true);
        this.session = session;
        const op = session.getOperation();
        const single = op.hasFlag(T.FLAG_SINGLE_LINE);
        const editor = document.createElement(single ? 'input' : 'textarea');
        this.editor = editor;
        configure(editor, op);
        const hint = session.getHint();
        if (hint) editor.placeholder = hint;
        editor.value = filtered(session.getText(), op);
        this.style(editor, session);
        this.place(session);

        editor.addEventListener('input', () => {
            const clean = filtered(editor.value, op);
            if (clean !== editor.value) {
                // A filtered character is dropped where it was typed, the caret kept after it.
                const at = Math.max(0, (editor.selectionStart ?? clean.length) - (editor.value.length - clean.length));
                editor.value = clean;
                editor.setSelectionRange(at, at);
            }
            if (this.session === session && session.isActive() && !op.hasFlag(T.FLAG_COMMIT_ON_DONE)) {
                session.setText(editor.value);
                this.page.repaint();
            }
        });
        editor.addEventListener('keydown', (e: Event) => {
            const k = e as KeyboardEvent;
            // A single-line field ends on Enter (the IME action key); a multi-line one keeps Enter
            // as a newline and ends on Escape or a click elsewhere.
            if ((k.key === 'Enter' && single && !k.isComposing) || k.key === 'Escape') {
                k.preventDefault();
                this.dismiss(true);
            }
        });
        editor.addEventListener('blur', () => { if (this.editor === editor) this.dismiss(true); });
        document.body.appendChild(editor);
        window.addEventListener('scroll', this.onViewport, true);
        window.addEventListener('resize', this.onViewport);
        editor.focus({ preventScroll: true });
        const end = editor.value.length;
        try { editor.setSelectionRange(end, end); } catch { /* an email or number input refuses a selection */ }
        this.page.repaint();
    }

    updateTextInputBounds(session: TextInputSession): void {
        if (this.session !== session || !this.editor) return;
        this.place(session);
    }

    stopTextInput(session: TextInputSession): void {
        if (this.session !== session) return;
        // The document ends the session itself: just drop the editor.
        this.removeEditor();
        this.session = null;
    }

    /** Ends the active session, if any, committing the text first (the document is going away). */
    stop(): void { this.dismiss(true); }

    private dismiss(commit: boolean): void {
        if (this.dismissing) return;
        this.dismissing = true;
        try {
            const session = this.session, editor = this.editor;
            if (session && session.isActive() && editor && commit) session.setText(editor.value);
            this.removeEditor();
            session?.end();
            this.session = null;
            this.page.repaint();
        } finally {
            this.dismissing = false;
        }
    }

    private removeEditor(): void {
        const editor = this.editor;
        this.editor = null;
        window.removeEventListener('scroll', this.onViewport, true);
        window.removeEventListener('resize', this.onViewport);
        editor?.remove();
    }

    /** The editor over the component's bounds, fixed to the viewport. */
    private place(session: TextInputSession): void {
        const editor = this.editor;
        if (!editor) return;
        const [x, y, w, h] = session.getBounds();
        const [left, top, width, height] = this.page.rect(x, y, w, h);
        Object.assign(editor.style, {
            left: `${left}px`, top: `${top}px`,
            width: `${Math.max(1, width)}px`, height: `${Math.max(1, height)}px`,
        });
    }

    /** Matches the editor's text to the component's: size, colour, weight, alignment, padding. */
    private style(editor: HTMLElement, session: TextInputSession): void {
        const s = this.page.scale();
        const c = session.getComponent() as any;
        const css: Record<string, string> = {
            position: 'fixed', zIndex: '2147483646', margin: '0', border: '0', outline: 'none',
            background: 'transparent', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
            fontFamily: 'sans-serif', lineHeight: 'normal',
            padding: `${(c.mPaddingTop ?? 0) * s}px ${(c.mPaddingRight ?? 0) * s}px ${(c.mPaddingBottom ?? 0) * s}px ${(c.mPaddingLeft ?? 0) * s}px`,
        };
        if (typeof c.getFontSizeValue === 'function') {
            const size = c.getFontSizeValue();
            if (size > 0) css.fontSize = `${size * s}px`;
            const color = c.getColorValue() | 0;
            css.color = argb(color);
            css.caretColor = argb(color);
            css.fontWeight = String(Math.round(c.getFontWeightValue() || 400));
            const align = c.getTextAlignValue();
            css.textAlign = align === 3 ? 'center' : align === 2 || align === 6 ? 'right' : 'left';
        }
        Object.assign(editor.style, css);
        editor.setAttribute('data-rc-text-input', String(session.getOperation().getTextId()));
    }
}

/** The modifier's keyboard type, IME action, flags and max length as input attributes. */
function configure(editor: HTMLInputElement | HTMLTextAreaElement, op: TextInputModifier): void {
    const input = editor instanceof HTMLInputElement ? editor : null;
    let inputMode = '';
    switch (op.getKeyboardType()) {
        case T.KEYBOARD_NUMBER: inputMode = 'numeric'; break;
        case T.KEYBOARD_DECIMAL: inputMode = 'decimal'; break;
        case T.KEYBOARD_NUMBER_PASSWORD: inputMode = 'numeric'; if (input) input.type = 'password'; break;
        case T.KEYBOARD_PHONE: inputMode = 'tel'; if (input) input.type = 'tel'; break;
        case T.KEYBOARD_URI: inputMode = 'url'; if (input) input.type = 'url'; break;
        case T.KEYBOARD_EMAIL: inputMode = 'email'; if (input) input.type = 'email'; break;
        case T.KEYBOARD_PASSWORD: if (input) input.type = 'password'; break;
        default: inputMode = 'text';
    }
    if (inputMode) editor.inputMode = inputMode;
    const hint = ({ [T.IME_ACTION_GO]: 'go', [T.IME_ACTION_SEARCH]: 'search', [T.IME_ACTION_SEND]: 'send',
        [T.IME_ACTION_PREVIOUS]: 'previous', [T.IME_ACTION_NEXT]: 'next', [T.IME_ACTION_DONE]: 'done' } as Record<number, string>)[op.getImeAction()]
        ?? (op.hasFlag(T.FLAG_SINGLE_LINE) ? 'done' : 'enter');
    editor.setAttribute('enterkeyhint', hint);
    const correct = op.hasFlag(T.FLAG_AUTO_CORRECT);
    editor.setAttribute('autocorrect', correct ? 'on' : 'off');
    editor.spellcheck = correct;
    editor.setAttribute('autocapitalize', op.hasFlag(T.FLAG_CAPITALIZE_CHARACTERS) ? 'characters'
        : op.hasFlag(T.FLAG_CAPITALIZE_WORDS) ? 'words' : op.hasFlag(T.FLAG_CAPITALIZE_SENTENCES) ? 'sentences' : 'off');
    editor.autocomplete = 'off';
    if (op.getMaxLength() > 0) editor.maxLength = op.getMaxLength();
}

/** The text with the characters the modifier's filter refuses removed, cut to its max length. */
export function filtered(text: string, op: TextInputModifier): string {
    let out = text;
    switch (op.getFilter()) {
        case T.FILTER_DIGITS: out = out.replace(/[^0-9]/g, ''); break;
        case T.FILTER_DECIMAL: out = out.replace(/[^0-9.,-]/g, ''); break;
        case T.FILTER_HEXADECIMAL: out = out.replace(/[^0-9a-fA-F]/g, ''); break;
        case T.FILTER_ALPHANUMERIC: out = out.replace(/[^\p{L}\p{N}]/gu, ''); break;
    }
    if (op.hasFlag(T.FLAG_SINGLE_LINE)) out = out.replace(/[\r\n]+/g, ' ');
    if (op.getMaxLength() > 0 && out.length > op.getMaxLength()) out = out.slice(0, op.getMaxLength());
    return out;
}

function argb(c: number): string {
    const a = ((c >>> 24) & 0xff) / 255;
    return `rgba(${(c >>> 16) & 0xff}, ${(c >>> 8) & 0xff}, ${c & 0xff}, ${a.toFixed(3)})`;
}

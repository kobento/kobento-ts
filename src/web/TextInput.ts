// The web player's text input (the View player's AndroidTextInputSupport on the web): an <input>
// (single line) or <textarea> placed over a TextInputLayout's bound text (or the whole layout when
// it has none), styled from that text, writing edits back into the document's string on every
// keystroke (or on closing with FLAG_COMMIT_ON_DONE). It is dismissed on Enter in a single-line field, on Escape, when it
// loses focus (a click elsewhere) or when the document goes away.

import type { TextInputSession, TextInputSupport } from '../core/TextInput';
import { TextInputLayout } from '../core/operations/layout/managers/TextInputLayout';
import { Visibility } from '../core/operations/layout/Component';

/** Maps document pixels to page (CSS, viewport) pixels: the player knows its canvas and transform. */
export interface DocumentToPage {
    /** [left, top, width, height] in viewport CSS pixels for a rectangle in document pixels. */
    rect(x: number, y: number, w: number, h: number): [number, number, number, number];
    /** CSS pixels per document pixel. */
    scale(): number;
    /** Asks the player for a frame (the edited string changed, or the editor closed). */
    repaint(): void;
}

const T = TextInputLayout;

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
        const op = session.getLayout();
        // A password keyboard makes the field secure, which is single line.
        const single = op.hasInputFlag(T.FLAG_SINGLE_LINE) || op.isPassword();
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
            if (this.session === session && session.isActive() && !op.hasInputFlag(T.FLAG_COMMIT_ON_DONE)) {
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

    /** The editor over the session's bounds (the text, else the layout), fixed to the viewport. */
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

    /**
     * Matches the editor's text to the bound text's: size, colour, weight, style, alignment,
     * padding. Without a bound text the editor covers the layout, inside its padding, in the
     * default style.
     */
    private style(editor: HTMLElement, session: TextInputSession): void {
        const s = this.page.scale();
        const text = session.getTextComponent();
        const c = (text ?? session.getLayout()) as any;
        const css: Record<string, string> = {
            position: 'fixed', zIndex: '2147483646', margin: '0', border: '0', outline: 'none',
            background: 'transparent', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
            fontFamily: 'sans-serif', lineHeight: 'normal',
            padding: `${(c.mPaddingTop ?? 0) * s}px ${(c.mPaddingRight ?? 0) * s}px ${(c.mPaddingBottom ?? 0) * s}px ${(c.mPaddingLeft ?? 0) * s}px`,
        };
        ensurePlaceholderStyle();
        if (text) {
            const size = text.getFontSizeValue();
            if (size > 0) css.fontSize = `${size * s}px`;
            // Lines as far apart as the canvas lays them out (CanvasPaintContext.layoutComplexText:
            // the size times the multiplier, 1.2 by default), so a multi-line field's first line
            // and caret land where the text and its hint were drawn. A single-line input centres
            // its line in a box one font height tall, which is already where the canvas puts it.
            if (editor instanceof HTMLTextAreaElement && size > 0) {
                const mult = (text as any).mLineHeightMultiplier;
                css.lineHeight = `${size * (mult > 0 && mult !== 1 ? mult : 1.2) * s}px`;
            }
            const color = text.getColorValue() | 0;
            css.color = argb(color);
            css.caretColor = argb(color);
            // The placeholder in the hint's colour (the text's at 45%), whatever the text does.
            css['--rc-placeholder'] = argb(color);
            // An invisible bound text: the document draws the content itself (a password's own
            // dots, a code's boxes). The editor then takes the typing and draws none of it — no
            // text, no caret: its bullets and caret would sit over the document's drawing out of
            // step with it (two sets of dots of different sizes).
            if (Visibility.isInvisible((text as any).mVisibility ?? 0)) {
                css.color = 'transparent';
                css.caretColor = 'transparent';
            }
            css.fontWeight = String(Math.round(text.getFontWeightValue() || 400));
            if (text.getFontStyle() === 1) css.fontStyle = 'italic';
            const align = text.getTextAlignValue();
            css.textAlign = align === 3 ? 'center' : align === 2 || align === 6 ? 'right' : 'left';
        } else {
            css.fontSize = `${36 * s}px`;   // TextStyle.DEFAULT_FONT_SIZE
            css.color = 'rgb(0, 0, 0)';
        }
        for (const [k, v] of Object.entries(css)) {
            if (k.startsWith('--')) editor.style.setProperty(k, v);
            else (editor.style as any)[k] = v;
        }
        editor.setAttribute('data-rc-text-input', String(session.getLayout().getTextId()));
    }
}

/**
 * The placeholder as the canvas draws the hint: the text's own colour at 45% (TextInputLayout
 * HINT_ALPHA_PERCENT), not the browser's grey. A pseudo-element cannot be styled inline, so one
 * rule for every editor goes into the page once.
 */
function ensurePlaceholderStyle(): void {
    if (typeof document === 'undefined' || document.getElementById('rc-text-input-style')) return;
    const style = document.createElement('style');
    style.id = 'rc-text-input-style';
    style.textContent = '[data-rc-text-input]::placeholder { color: var(--rc-placeholder, currentColor); opacity: 0.45; }';
    (document.head ?? document.body).appendChild(style);
}

/** The layout's keyboard type, IME action, flags, max length and content type as input attributes. */
function configure(editor: HTMLInputElement | HTMLTextAreaElement, op: TextInputLayout): void {
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
        ?? (editor instanceof HTMLInputElement ? 'done' : 'enter');
    editor.setAttribute('enterkeyhint', hint);
    // A secure field takes no suggestions (and the browser offers no copy of a password input).
    const correct = op.hasInputFlag(T.FLAG_AUTO_CORRECT) && !op.isPassword();
    editor.setAttribute('autocorrect', correct ? 'on' : 'off');
    editor.spellcheck = correct;
    editor.setAttribute('autocapitalize', op.hasInputFlag(T.FLAG_CAPITALIZE_CHARACTERS) ? 'characters'
        : op.hasInputFlag(T.FLAG_CAPITALIZE_WORDS) ? 'words' : op.hasInputFlag(T.FLAG_CAPITALIZE_SENTENCES) ? 'sentences' : 'off');
    editor.autocomplete = (AUTOCOMPLETE[op.getContentType()] ?? 'off') as AutoFill;
    if (op.getMaxLength() > 0) editor.maxLength = op.getMaxLength();
}

/** The content types as HTML autocomplete tokens (CONTENT_TYPE_NONE: off). */
const AUTOCOMPLETE: Record<number, string> = {
    [T.CONTENT_TYPE_PERSON_NAME]: 'name',
    [T.CONTENT_TYPE_PERSON_FIRST_NAME]: 'given-name',
    [T.CONTENT_TYPE_PERSON_LAST_NAME]: 'family-name',
    [T.CONTENT_TYPE_EMAIL_ADDRESS]: 'email',
    [T.CONTENT_TYPE_PHONE_NUMBER]: 'tel',
    [T.CONTENT_TYPE_USERNAME]: 'username',
    [T.CONTENT_TYPE_PASSWORD]: 'current-password',
    [T.CONTENT_TYPE_NEW_PASSWORD]: 'new-password',
    [T.CONTENT_TYPE_ONE_TIME_CODE]: 'one-time-code',
    [T.CONTENT_TYPE_POSTAL_ADDRESS]: 'street-address',
    [T.CONTENT_TYPE_POSTAL_CODE]: 'postal-code',
    [T.CONTENT_TYPE_CREDIT_CARD_NUMBER]: 'cc-number',
    [T.CONTENT_TYPE_CREDIT_CARD_EXPIRATION_DATE]: 'cc-exp',
    [T.CONTENT_TYPE_CREDIT_CARD_SECURITY_CODE]: 'cc-csc',
};

/**
 * Typing without an editor, for tools that check a document (the MCP inspector): what
 * WebTextInputSupport does with these keystrokes. Each character goes through the layout's
 * filter and max length as the editor's input event applies them; the string follows each
 * keystroke unless the layout commits on done; with `done` the session ends as Enter or a click
 * elsewhere ends it, committing the text. Returns the text the field holds.
 */
export function typeText(session: TextInputSession, typed: string, done = true): string {
    const op = session.getLayout();
    const live = !op.hasInputFlag(T.FLAG_COMMIT_ON_DONE);
    let value = filtered(session.getText(), op);
    for (const ch of typed) {
        value = filtered(value + ch, op);
        if (live && session.isActive()) session.setText(value);
    }
    if (done && session.isActive()) {
        session.setText(value);
        session.end();
    }
    return value;
}

/** The text with the characters the layout's filter refuses removed, cut to its max length. */
export function filtered(text: string, op: TextInputLayout): string {
    let out = text;
    switch (op.getFilter()) {
        case T.FILTER_DIGITS: out = out.replace(/[^0-9]/g, ''); break;
        case T.FILTER_DECIMAL: out = out.replace(/[^0-9.,-]/g, ''); break;
        case T.FILTER_HEXADECIMAL: out = out.replace(/[^0-9a-fA-F]/g, ''); break;
        case T.FILTER_ALPHANUMERIC: out = out.replace(/[^\p{L}\p{N}]/gu, ''); break;
    }
    if (op.hasInputFlag(T.FLAG_SINGLE_LINE) || op.isPassword()) out = out.replace(/[\r\n]+/g, ' ');
    if (op.getMaxLength() > 0 && out.length > op.getMaxLength()) out = out.slice(0, op.getMaxLength());
    return out;
}

function argb(c: number): string {
    const a = ((c >>> 24) & 0xff) / 255;
    return `rgba(${(c >>> 16) & 0xff}, ${(c >>> 8) & 0xff}, ${c & 0xff}, ${a.toFixed(3)})`;
}

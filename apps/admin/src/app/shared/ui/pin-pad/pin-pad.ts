import { Component, HostListener, computed, input, model, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/** Digits laid out as a phone keypad: 1-9, then blank / 0 / delete. */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** How long a key stays visually pressed. Long enough to see, short enough not to lag typing. */
const PRESS_FEEDBACK_MS = 140;

/**
 * On-screen numeric keypad for entering a PIN.
 *
 * ## Why there is no `<input>` behind this
 *
 * The PIN is entered on the keypad and nowhere else. There is no focusable text field, so no
 * device keyboard — native or third-party, browser or installed PWA — can be summoned for it
 * on any platform. That is stronger than `inputmode="numeric"`, which only *asks* for a
 * numeric layout and is routinely ignored by third-party keyboards, and stronger than
 * `readonly`, which suppresses the keyboard on some platforms and not others.
 *
 * It also means the entered digits never sit in a DOM input's `value`, so they cannot be
 * autofilled, autocompleted, spell-checked, or restored by a browser's form-restoration on
 * back-navigation.
 *
 * ## Both pointer and physical keyboard
 *
 * Desktop operators should not have to reach for the mouse, so digits, Backspace and Enter
 * are handled from the physical keyboard too, and produce the SAME visual press as a click.
 * The listener ignores events originating in a text field, so typing an email address in the
 * identifier box never registers as PIN entry.
 *
 * ## Styling
 *
 * Theme classes only — `btn`, `btn-outline-secondary`, `form-control`, and Bootstrap's own
 * `.active` for the pressed state, which is exactly the inset/shadow treatment a pressed key
 * should have. Nothing here invents a look the rest of the back office does not already use.
 */
@Component({
	selector: 'app-pin-pad',
	templateUrl: './pin-pad.html',
	styleUrls: ['./pin-pad.scss'],
	imports: [TranslocoModule],
})
export class PinPad {
	/** How many digits a complete PIN has. The owner lock is six. */
	readonly length = input<number>(6);

	/** Two-way bound so a parent form control stays the single source of truth. */
	readonly value = model<string>('');

	/** Emitted when the last digit lands, so a parent may submit without a second click. */
	readonly completed = output<string>();

	readonly keys = KEYS;

	/** The key currently showing a press, from either pointer or keyboard. */
	private readonly pressed = signal<string | null>(null);

	/** One cell per digit; filled cells render a dot rather than the digit itself. */
	readonly cells = computed(() => Array.from({ length: this.length() }, (_, index) => index < this.value().length));

	readonly isComplete = computed(() => this.value().length >= this.length());

	isPressed(key: string): boolean {
		return this.pressed() === key;
	}

	append(digit: string): void {
		this.flash(digit);
		if (this.isComplete()) return;

		const next = this.value() + digit;
		this.value.set(next);
		if (next.length === this.length()) this.completed.emit(next);
	}

	backspace(): void {
		this.flash('Backspace');
		this.value.set(this.value().slice(0, -1));
	}

	clear(): void {
		this.value.set('');
	}

	/**
	 * Physical keyboard support.
	 *
	 * Bound to the document rather than to the component, because the keypad is not focusable
	 * and an operator should be able to start typing digits the moment the PIN step appears.
	 * Anything typed into a real field is left alone — otherwise entering an identifier would
	 * silently fill the PIN as well.
	 */
	@HostListener('document:keydown', ['$event'])
	handleKeydown(event: KeyboardEvent): void {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTextEntry(event.target)) return;

		if (/^[0-9]$/.test(event.key)) {
			event.preventDefault();
			this.append(event.key);
			return;
		}
		if (event.key === 'Backspace') {
			event.preventDefault();
			this.backspace();
		}
	}

	/** Shows the pressed state briefly, so a keyboard press looks like a tap. */
	private flash(key: string): void {
		this.pressed.set(key);
		setTimeout(() => {
			if (this.pressed() === key) this.pressed.set(null);
		}, PRESS_FEEDBACK_MS);
	}
}

/** True when the event came from somewhere the operator is genuinely typing. */
function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;

	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

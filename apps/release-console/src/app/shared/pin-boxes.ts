import {
	ChangeDetectionStrategy,
	Component,
	type ElementRef,
	Injector,
	afterNextRender,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
	viewChildren,
} from '@angular/core';

export const PIN_LENGTH = 6;

/** Spreads typed or pasted digits over the boxes from `start`; returns the new digits and the box to focus. */
export function fillDigits(digits: string[], start: number, typed: string): { digits: string[]; focus: number } {
	const next = [...digits];
	const incoming = typed.replace(/\D/g, '').split('');
	let at = start;
	for (const d of incoming) {
		if (at >= PIN_LENGTH) break;
		next[at] = d;
		at += 1;
	}
	if (!incoming.length) next[start] = '';
	return { digits: next, focus: Math.min(incoming.length ? at : start, PIN_LENGTH - 1) };
}

/**
 * The console's six PIN boxes (the lock screen's, shared with every dialog that asks for the PIN):
 * the PIN is typed straight into the boxes, each digit moves to the next box, Backspace and the
 * arrows move between them, a pasted PIN fills all six, and the sixth digit sends `complete`.
 */
@Component({
	selector: 'rc-pin-boxes',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div
			class="rc-pin"
			role="group"
			[attr.aria-label]="label()"
		>
			@for (i of slots; track i) {
				<span [class.on]="!!digits()[i]">
					<input
						#box
						type="password"
						inputmode="numeric"
						maxlength="6"
						[attr.autocomplete]="i === 0 ? 'one-time-code' : 'off'"
						[attr.aria-label]="'PIN digit ' + (i + 1) + ' of 6'"
						[value]="digits()[i]"
						[disabled]="disabled()"
						(input)="type(i, box)"
						(keydown)="key(i, $event)"
						(focus)="box.select()"
					/>
				</span>
			}
		</div>
	`,
})
export class PinBoxes {
	private readonly injector = inject(Injector);
	private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');
	readonly label = input('Console PIN');
	readonly disabled = input(false);
	/** Takes the keyboard when the boxes appear (lock screen, dialogs); off for a form inside a page. */
	readonly autofocus = input(true);
	/** The full PIN, once the sixth digit is typed. */
	readonly complete = output<string>();
	/** The digits typed so far, joined. */
	readonly changed = output<string>();
	protected readonly slots = [0, 1, 2, 3, 4, 5];
	protected readonly digits = signal<string[]>(Array<string>(PIN_LENGTH).fill(''));
	readonly value = computed(() => this.digits().join(''));

	constructor() {
		// The first box takes the keyboard as soon as the boxes appear, unless the page asks otherwise.
		let focused = false;
		effect(() => {
			if (!focused && this.boxes().length && this.autofocus()) {
				focused = true;
				this.focus(0);
			}
		});
	}

	protected type(i: number, box: HTMLInputElement): void {
		const { digits, focus } = fillDigits(this.digits(), i, box.value);
		// fillDigits always answers all six slots.
		box.value = digits[i] as string;
		this.digits.set(digits);
		this.changed.emit(this.value());
		this.focus(focus);
		if (this.value().length === PIN_LENGTH && !this.disabled()) this.complete.emit(this.value());
	}

	protected key(i: number, e: KeyboardEvent): void {
		if (e.key === 'Backspace' && !this.digits()[i] && i > 0) {
			e.preventDefault();
			this.digits.update((d) => d.map((x, n) => (n === i - 1 ? '' : x)));
			this.changed.emit(this.value());
			this.focus(i - 1);
		} else if (e.key === 'ArrowLeft' && i > 0) this.focus(i - 1);
		else if (e.key === 'ArrowRight' && i < PIN_LENGTH - 1) this.focus(i + 1);
	}

	/** Moves the keyboard to box `i` at once, so fast typing and pasting land in the right box. */
	private focus(i: number): void {
		queueMicrotask(() => this.boxes()[i]?.nativeElement.focus());
	}

	/**
	 * Empties the boxes and puts the keyboard in the first one. The boxes are disabled while a PIN is
	 * checked, and a disabled box cannot take the focus, so this waits for the render that enables them.
	 */
	clear(): void {
		this.digits.set(Array<string>(PIN_LENGTH).fill(''));
		this.changed.emit('');
		afterNextRender(() => this.boxes()[0]?.nativeElement.focus(), { injector: this.injector });
	}
}

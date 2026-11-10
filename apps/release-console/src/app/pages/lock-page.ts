import {
	ChangeDetectionStrategy,
	Component,
	type ElementRef,
	computed,
	effect,
	inject,
	signal,
	viewChildren,
} from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleSession } from '../data/session';

const LENGTH = 6;

/** Spreads typed or pasted digits over the boxes from `start`; returns the new digits and the box to focus. */
export function fillDigits(digits: string[], start: number, typed: string): { digits: string[]; focus: number } {
	const next = [...digits];
	const incoming = typed.replace(/\D/g, '').split('');
	let at = start;
	for (const d of incoming) {
		if (at >= LENGTH) break;
		next[at] = d;
		at += 1;
	}
	if (!incoming.length) next[start] = '';
	return { digits: next, focus: Math.min(incoming.length ? at : start, LENGTH - 1) };
}

/**
 * The lock screen: set the PIN on first run, then unlock with it. The PIN is typed straight into
 * the six boxes; the sixth digit submits. Five wrong tries lock the console for 15 minutes.
 */
@Component({
	selector: 'rc-lock-page',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc">
			<div class="pj-lock">
				<form
					class="pj-lockbox"
					(submit)="submit($event)"
				>
					<span
						class="rc-logo pj-biglogo"
						aria-hidden="true"
					></span>
					<h2 class="rc-title">Release Console</h2>
					@if (status.isError()) {
						<p class="rc-p">
							The console API is not answering. Start it with
							<code>pnpm console</code>
							.
						</p>
					} @else if (status.data(); as s) {
						@if (lockedUntil(); as until) {
							<p class="rc-p">Too many wrong tries. The console opens again at {{ until }}.</p>
						} @else {
							<p
								class="rc-p"
								id="pin-help"
							>
								@if (!s.pinSet) {
									{{
										confirming()
											? 'Type the same 6 digits again.'
											: 'First time: choose a 6-digit console PIN.'
									}}
								} @else {
									On this computer only. Enter your 6-digit console PIN.
								}
							</p>
							<div
								class="rc-pin"
								role="group"
								aria-labelledby="pin-help"
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
											[disabled]="busy()"
											(input)="type(i, box)"
											(keydown)="key(i, $event)"
											(focus)="box.select()"
										/>
									</span>
								}
							</div>
							@if (message()) {
								<p class="rc-note">{{ message() }}</p>
							}
							<button
								type="submit"
								class="rc-btn primary"
								[disabled]="pin().length !== 6 || busy()"
							>
								<span
									class="lock"
									aria-hidden="true"
								></span>
								{{ !s.pinSet ? (confirming() ? 'Set PIN' : 'Next') : 'Unlock' }}
							</button>
							<p class="rc-note">
								{{
									s.pinSet
										? s.triesLeft + ' tries left before a 15-minute lock.'
										: 'Keys you add later go to the macOS Keychain; macOS may ask once to let the console use them. 5 wrong tries lock the console for 15 minutes.'
								}}
							</p>
						}
					}
				</form>
			</div>
		</div>
	`,
})
export class LockPage {
	private readonly api = inject(ConsoleApi);
	private readonly session = inject(ConsoleSession);
	private readonly router = inject(Router);
	private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');
	protected readonly slots = [0, 1, 2, 3, 4, 5];
	protected readonly digits = signal<string[]>(Array<string>(LENGTH).fill(''));
	protected readonly pin = computed(() => this.digits().join(''));
	protected readonly first = signal<string | null>(null);
	protected readonly confirming = computed(() => this.first() !== null);
	protected readonly message = signal('');
	protected readonly busy = signal(false);
	protected readonly status = injectQuery(() => ({
		queryKey: ['lock-status'],
		queryFn: () => this.api.lockStatus(),
	}));
	protected readonly lockedUntil = computed(() => {
		const until = this.status.data()?.lockedUntil;
		return until ? new Date(until).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null;
	});

	constructor() {
		void this.api.lockStatus().then(
			(s) => {
				if (s.unlocked) void this.router.navigate(['/']);
			},
			() => undefined,
		);
		// The boxes appear once the lock status arrives; the first one takes the keyboard then.
		let focused = false;
		effect(() => {
			if (!focused && this.boxes().length) {
				focused = true;
				this.focus(0);
			}
		});
	}

	/** A digit (or a pasted PIN) typed into box `i`; the sixth digit submits. */
	protected type(i: number, box: HTMLInputElement): void {
		const { digits, focus } = fillDigits(this.digits(), i, box.value);
		box.value = digits[i] ?? '';
		this.digits.set(digits);
		this.focus(focus);
		if (this.pin().length === LENGTH && !this.busy()) void this.submit();
	}

	protected key(i: number, e: KeyboardEvent): void {
		if (e.key === 'Backspace' && !this.digits()[i] && i > 0) {
			e.preventDefault();
			this.digits.update((d) => d.map((x, n) => (n === i - 1 ? '' : x)));
			this.focus(i - 1);
		} else if (e.key === 'ArrowLeft' && i > 0) this.focus(i - 1);
		else if (e.key === 'ArrowRight' && i < LENGTH - 1) this.focus(i + 1);
	}

	private focus(i: number): void {
		queueMicrotask(() => this.boxes()[i]?.nativeElement.focus());
	}

	private clear(): void {
		this.digits.set(Array<string>(LENGTH).fill(''));
		this.focus(0);
	}

	protected async submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (this.busy()) return;
		const s = this.status.data();
		if (!s || this.pin().length !== LENGTH) return;
		if (!s.pinSet && this.first() === null) {
			this.first.set(this.pin());
			this.message.set('');
			this.clear();
			return;
		}
		if (!s.pinSet && this.first() !== this.pin()) {
			this.first.set(null);
			this.message.set('The two PINs differ. Start again.');
			this.clear();
			return;
		}
		this.busy.set(true);
		try {
			const answer = s.pinSet ? await this.api.unlock(this.pin()) : await this.api.setupPin(this.pin());
			this.session.set(answer.session);
			void this.router.navigate(['/']);
		} catch (err) {
			this.message.set((err as Error).message);
			void this.status.refetch();
		} finally {
			this.busy.set(false);
			if (this.message()) this.clear();
		}
	}
}

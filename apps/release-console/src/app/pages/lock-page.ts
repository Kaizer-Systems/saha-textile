import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleSession } from '../data/session';

/** The lock screen: set the PIN on first run, then unlock with it. Five wrong tries lock it for 15 minutes. */
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
							<p class="rc-p">
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
								aria-hidden="true"
							>
								@for (i of slots; track i) {
									<span [class.on]="pin().length > i"></span>
								}
							</div>
							<div class="rc-msearch">
								<input
									#box
									type="password"
									inputmode="numeric"
									autocomplete="off"
									maxlength="6"
									aria-label="Console PIN"
									[value]="pin()"
									(input)="type(box.value)"
								/>
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
	protected readonly slots = [0, 1, 2, 3, 4, 5];
	protected readonly pin = signal('');
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
	}

	/** The sixth digit submits by itself; Enter and the button do the same. */
	protected type(value: string): void {
		this.pin.set(value.replace(/\D/g, '').slice(0, 6));
		if (this.pin().length === 6 && !this.busy()) void this.submit();
	}

	protected async submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (this.busy()) return;
		const s = this.status.data();
		if (!s || this.pin().length !== 6) return;
		if (!s.pinSet && this.first() === null) {
			this.first.set(this.pin());
			this.pin.set('');
			this.message.set('');
			return;
		}
		if (!s.pinSet && this.first() !== this.pin()) {
			this.first.set(null);
			this.pin.set('');
			this.message.set('The two PINs differ. Start again.');
			return;
		}
		this.busy.set(true);
		try {
			const answer = s.pinSet ? await this.api.unlock(this.pin()) : await this.api.setupPin(this.pin());
			this.session.set(answer.session);
			void this.router.navigate(['/']);
		} catch (err) {
			this.pin.set('');
			this.message.set((err as Error).message);
			void this.status.refetch();
		} finally {
			this.busy.set(false);
		}
	}
}

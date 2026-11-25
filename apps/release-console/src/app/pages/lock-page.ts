import {
	ChangeDetectionStrategy,
	Component,
	type ElementRef,
	computed,
	effect,
	inject,
	signal,
	viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleSession } from '../data/session';
import { Icon } from '../shared/icons';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';
import { VersionBanner } from '../shared/version-banner';

const LENGTH = PIN_LENGTH;

export { fillDigits } from '../shared/pin-boxes';

/**
 * The lock screen: set the PIN on first run, then unlock with the PIN or, once one is set, the
 * password. The PIN is typed straight into the six boxes; the sixth digit submits. Five wrong tries lock the console for 15 minutes.
 */
@Component({
	selector: 'rc-lock-page',
	imports: [Icon, PinBoxes, VersionBanner],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc">
			<div class="pj-lock">
				<rc-version-banner />
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
									On this computer only.
									{{
										method() === 'password'
											? 'Enter your console password.'
											: 'Enter your 6-digit console PIN.'
									}}
								}
							</p>
							@if (s.passwordSet) {
								<div
									class="rc-states"
									role="tablist"
									aria-label="Sign in with"
								>
									<button
										type="button"
										class="rc-chip"
										role="tab"
										[class.on]="method() === 'pin'"
										[attr.aria-selected]="method() === 'pin'"
										(click)="useMethod('pin')"
									>
										<rc-icon name="tabler/dialpad" />
										PIN
									</button>
									<button
										type="button"
										class="rc-chip"
										role="tab"
										[class.on]="method() === 'password'"
										[attr.aria-selected]="method() === 'password'"
										(click)="useMethod('password')"
									>
										<rc-icon name="tabler/password" />
										Password
									</button>
								</div>
							}
							@if (method() === 'password') {
								<div class="rc-msearch">
									<input
										#passwordBox
										type="password"
										autocomplete="current-password"
										aria-label="Console password"
										placeholder="Console password"
										[disabled]="busy()"
										(input)="password.set(passwordBox.value)"
									/>
								</div>
							} @else {
								<rc-pin-boxes
									label="Console PIN"
									[disabled]="busy()"
									(changed)="pin.set($event)"
									(complete)="submit()"
								/>
							}
							@if (message()) {
								<p class="rc-note">{{ message() }}</p>
							}
							<button
								type="submit"
								class="rc-btn primary"
								[disabled]="(method() === 'password' ? !password() : pin().length !== 6) || busy()"
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
										: 'Keys stay in Infisical; the console reads them from its key file. 5 wrong tries lock the console for 15 minutes.'
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
	private readonly pins = viewChild(PinBoxes);
	private readonly passwordBox = viewChild<ElementRef<HTMLInputElement>>('passwordBox');
	protected readonly pin = signal('');
	protected readonly first = signal<string | null>(null);
	protected readonly confirming = computed(() => this.first() !== null);
	protected readonly message = signal('');
	protected readonly busy = signal(false);
	protected readonly method = signal<'pin' | 'password'>('pin');
	protected readonly password = signal('');
	private methodChosen = false;
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
		// Open with the method chosen in Console settings, until the owner picks the other one here.
		effect(() => {
			const s = this.status.data();
			if (s && !this.methodChosen) this.method.set(s.passwordSet ? s.preferred : 'pin');
		});
		// The password box takes the keyboard whenever it appears.
		effect(() => {
			const box = this.passwordBox();
			if (box) queueMicrotask(() => box.nativeElement.focus());
		});
	}

	/** Empties the PIN boxes and puts the keyboard back in the first one. */
	private clear(): void {
		this.pins()?.clear();
	}

	protected useMethod(m: 'pin' | 'password'): void {
		this.methodChosen = true;
		this.method.set(m);
		this.message.set('');
		if (m === 'pin') this.clear();
	}

	protected async submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (this.busy()) return;
		const s = this.status.data();
		if (s?.pinSet && this.method() === 'password') {
			if (!this.password()) return;
			await this.send({ password: this.password() });
			return;
		}
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
		if (s.pinSet) await this.send({ pin: this.pin() });
		else await this.setup();
	}

	private async setup(): Promise<void> {
		this.busy.set(true);
		try {
			this.session.set((await this.api.setupPin(this.pin())).session);
			void this.router.navigate(['/']);
		} catch (err) {
			this.message.set((err as Error).message);
			void this.status.refetch();
		} finally {
			this.busy.set(false);
			if (this.message()) this.clear();
		}
	}

	private async send(given: { pin: string } | { password: string }): Promise<void> {
		this.busy.set(true);
		try {
			this.session.set((await this.api.unlock(given)).session);
			void this.router.navigate(['/']);
		} catch (err) {
			this.message.set((err as Error).message);
			this.password.set('');
			void this.status.refetch();
		} finally {
			this.busy.set(false);
			if (this.message() && 'pin' in given) this.clear();
		}
	}
}

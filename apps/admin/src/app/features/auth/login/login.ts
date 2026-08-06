import { Component, inject, linkedSignal, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { AuthStore } from '@core/state/auth.store';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';
import { PinPad } from '@shared/ui/pin-pad/pin-pad';

/** Owner lock: exactly six digits, password-grade hashed, five failures lock PIN use. */
const PIN_LENGTH = 6;

/**
 * Admin sign-in.
 *
 * The launch methods are exactly two, and they are the ones the owner locked:
 * **email-or-username plus password**, and **email-or-username plus a configured
 * six-digit PIN**. There is no social login, no self-registration and no OTP login on this
 * screen — those are excluded by decision, not pending implementation.
 *
 * The identifier field accepts either an email address or a username, so it is validated as
 * a non-empty string rather than as an email; the API resolves which one it is.
 *
 * The demo `admin@example.com` / `123456789` pair that used to pre-fill this form is gone,
 * along with the navigation that fired before the API had answered.
 */
@Component({
	selector: 'app-login',
	templateUrl: './login.html',
	styleUrls: ['./login.scss'],
	imports: [Alert, ReactiveFormsModule, RouterLink, TranslocoModule, Button, PinPad],
})
export class Login {
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);

	public form: FormGroup;

	/** Which credential the operator is entering. Presentation only — the API decides policy. */
	public readonly method = signal<'password' | 'pin'>('password');
	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly pinLength = PIN_LENGTH;

	/**
	 * The keypad's value, mirrored into the reactive form so the form stays the single source
	 * of truth for submission. `linkedSignal` resets it whenever the method changes, so a
	 * half-typed PIN never survives a switch to password entry and back.
	 */
	public readonly pin = linkedSignal<'password' | 'pin', string>({
		source: this.method,
		computation: () => '',
	});

	constructor() {
		this.form = this.formBuilder.group({
			// Email OR username: validated as present, not as an email address.
			identifier: new FormControl('', [Validators.required]),
			password: new FormControl(''),
		});
	}

	useMethod(method: 'password' | 'pin'): void {
		this.method.set(method);
		this.authStore.clearError();
	}

	async submit(): Promise<void> {
		this.form.controls['identifier'].markAsTouched();
		if (this.form.controls['identifier'].invalid || this.pending()) return;

		const identifier = (this.form.value.identifier as string).trim();
		const signedIn =
			this.method() === 'pin' ? await this.submitPin(identifier) : await this.submitPassword(identifier);

		// Navigate only once the API has issued a session and `/me` has confirmed it.
		if (signedIn) await this.router.navigateByUrl('/dashboard');
	}

	private async submitPassword(identifier: string): Promise<boolean> {
		this.form.controls['password'].markAsTouched();
		const password = (this.form.value.password as string) ?? '';
		if (!password) return false;
		return this.authStore.loginWithPassword({ identifier, password });
	}

	private async submitPin(identifier: string): Promise<boolean> {
		// Read from the keypad rather than a form control: there is no PIN text field to
		// touch, because a focusable one would let a device keyboard open.
		const pin = this.pin();
		// Length is checked here only to avoid spending a rate-limited attempt on input
		// that cannot possibly match; the API enforces the real policy and the lockout.
		if (pin.length !== PIN_LENGTH) return false;
		return this.authStore.loginWithPin({ identifier, pin });
	}
}

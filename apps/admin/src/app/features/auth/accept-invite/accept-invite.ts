import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { AdminAuthGateway } from '@core/auth/auth-gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';
import { PinPad } from '@shared/ui/pin-pad/pin-pad';

/** Owner lock: minimum 12 characters whenever a password is set or changed. */
const PASSWORD_MIN_LENGTH = 12;
const PIN_LENGTH = 6;

/**
 * Accepts a back-office invitation: the invitee sets a password and, optionally, a PIN.
 *
 * The token arrives in `?token=` from the `admin_invite` email, whose MSG91 template builds
 * the link for its own environment. Like the recovery token it is the entire authorization
 * here: single-use, stored server-side only as a hash, read from the URL once and never
 * copied into the store or browser storage.
 *
 * No session is issued. The new operator signs in on the login page with the credential they
 * just chose, which proves it works rather than trusting the invitation link twice. The PIN
 * step is skippable (owner lock 2026-07-23); "prefer PIN" is offered only once a PIN exists,
 * because `pin` is not a legal preference without one.
 *
 * Built from the update-password screen and the Account Security PIN pads — no new UI.
 */
@Component({
	selector: 'app-accept-invite',
	templateUrl: './accept-invite.html',
	styleUrls: ['./accept-invite.scss'],
	imports: [Alert, ReactiveFormsModule, NgClass, Button, PinPad, TranslocoModule],
})
export class AcceptInvite {
	private gateway = inject(AdminAuthGateway);
	private formBuilder = inject(FormBuilder);
	private notificationService = inject(NotificationService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private transloco = inject(TranslocoService);

	public form: FormGroup;
	public show: boolean = false;

	public readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
	public readonly error = signal<string | null>(null);
	public readonly pending = signal(false);
	public readonly pinLength = PIN_LENGTH;
	public readonly pin = signal('');
	public readonly confirmPin = signal('');
	public readonly preferPin = signal(false);

	/** A PIN is being set only once all six digits are in; a partial entry is treated as none. */
	public readonly settingPin = computed(() => this.pin().length === PIN_LENGTH);
	public readonly pinMismatch = computed(
		() => this.settingPin() && this.confirmPin().length === PIN_LENGTH && this.pin() !== this.confirmPin(),
	);

	constructor() {
		this.form = this.formBuilder.group({
			displayName: new FormControl('', [Validators.maxLength(120)]),
			// Mirrors the server policy so the failure is visible before a round trip. The
			// server remains the authority; this is convenience only.
			newPassword: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
			confirmPassword: new FormControl('', [Validators.required]),
		});
	}

	get passwordMismatch(): boolean {
		const { newPassword, confirmPassword } = this.form.value as Record<string, string>;
		return Boolean(confirmPassword) && newPassword !== confirmPassword;
	}

	showPassword(): void {
		this.show = !this.show;
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.token() || !this.form.valid || this.passwordMismatch || this.pending()) return;
		// A half-typed PIN is an unfinished choice, not a skipped one: say so rather than drop it.
		if (this.pin().length > 0 && !this.settingPin()) {
			this.error.set(this.transloco.translate('pin_must_be_6_digits'));
			return;
		}
		if (this.settingPin() && this.confirmPin() !== this.pin()) {
			this.error.set(this.transloco.translate('pins_do_not_match'));
			return;
		}

		const displayName = (this.form.value.displayName as string).trim();
		this.pending.set(true);
		this.error.set(null);
		try {
			await firstValueFrom(
				this.gateway.acceptInvite({
					token: this.token(),
					password: this.form.value.newPassword as string,
					...(displayName ? { displayName } : {}),
					...(this.settingPin()
						? { pin: this.pin(), preferredLoginMethod: this.preferPin() ? 'pin' : 'password' }
						: {}),
				}),
			);
		} catch (error) {
			this.pending.set(false);
			this.error.set(this.refusalMessage(error));
			return;
		}

		this.notificationService.showSuccess(this.transloco.translate('account_created_sign_in'));
		await this.router.navigateByUrl('/auth/login');
	}

	/**
	 * Weak password or PIN refusals carry the server's own reason and leave the invitation
	 * unspent, so the invitee can fix it and resubmit. Everything else — expired, revoked,
	 * already used, unknown — answers one message, as the API intends.
	 */
	private refusalMessage(error: unknown): string {
		if (error instanceof HttpErrorResponse) {
			const issue = error.error?.error?.issues?.[0]?.message;
			if (typeof issue === 'string') return issue;
			if (error.status === 400 && typeof error.error?.error?.message === 'string') {
				return error.error.error.message as string;
			}
			if (error.status === 401) return this.transloco.translate('invalid_or_expired_invitation_link');
		}
		return this.transloco.translate('something_went_wrong_please_try_again');
	}
}

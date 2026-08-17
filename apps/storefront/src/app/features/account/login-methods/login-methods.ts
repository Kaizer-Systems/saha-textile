import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import {
	StorefrontAuthGateway,
	type LoginMethodsView,
	type SocialProvider,
	type StepUpProof,
} from '@core/auth/auth-gateway';
import { refusalCode } from '@core/auth/refusal-code';
import { ResendCountdown } from '@core/auth/resend-countdown';
import { Button } from '@shared/ui/button/button';
import { SocialSignIn, type ProviderCredential } from '@shared/ui/social-sign-in/social-sign-in';
import { CustomValidators } from '@shared/validators/password-match';

/** Owner lock: minimum 12 characters for storefront and admin alike. */
const PASSWORD_MIN_LENGTH = 12;
/** Owner lock: six-digit CSPRNG code, 10-minute expiry, five attempts. */
const OTP_CODE_LENGTH = 6;

/** What happens once the person has proved themselves. */
type PendingAction =
	| { kind: 'password' }
	| { kind: 'disconnect'; provider: SocialProvider }
	| { kind: 'connect'; credential: ProviderCredential };

const NOTICE_FOR: Record<PendingAction['kind'], string> = {
	password: 'password_updated',
	disconnect: 'provider_disconnected',
	connect: 'provider_connected',
};

/**
 * Account security: every way this person can sign in, and how to change them.
 *
 * ## The screen renders the server's answer, never its own
 *
 * Each mutation returns the whole method list and the view is replaced with it. Nothing is
 * patched optimistically. A security screen that guessed what changed could show a provider as
 * disconnected while it is still attached, or a password as set when the request was refused —
 * and this is exactly the screen where that would matter.
 *
 * ## Proof, then the change
 *
 * Connect, disconnect and setting a password all need fresh proof that the account holder is at
 * the keyboard, because a stolen session must not be able to add a permanent new way in or
 * remove somebody's last one. Which proof is required is the SERVER's decision, read from
 * `stepUpMethod`: a password where one exists, a one-time code where none does.
 *
 * For connect the proof is asked for AFTER the provider dialog rather than before, because the
 * buttons are the providers' own and Google's owns its click — there is no moment to interrupt
 * in between. The credential is held in memory only until the dialog is answered.
 *
 * ## Last-credential refusals belong to the server
 *
 * The screen hides nothing on the grounds that it "would fail". It sends the request and shows
 * the refusal, because the rule about what counts as a last credential lives in the domain and
 * a copy of it here would be a second implementation free to disagree.
 */
@Component({
	selector: 'app-login-methods',
	templateUrl: './login-methods.html',
	imports: [ReactiveFormsModule, TranslocoModule, Button, SocialSignIn],
})
export class LoginMethods {
	private readonly gateway = inject(StorefrontAuthGateway);
	private readonly formBuilder = inject(FormBuilder);
	private readonly modalService = inject(NgbModal);
	private readonly platformId = inject<Object>(PLATFORM_ID);

	private readonly stepUpModal = viewChild<TemplateRef<unknown>>('stepUpModal');

	/** The server's view. Null until the first load resolves. */
	readonly methods = signal<LoginMethodsView | null>(null);
	readonly loading = signal(true);
	readonly busy = signal(false);
	/** Stable refusal code from the API, rendered as a translated message. */
	readonly refusal = signal<string | null>(null);
	readonly notice = signal<string | null>(null);

	/** Non-null while the step-up dialog is open; names what happens once proof is given. */
	readonly pending = signal<PendingAction | null>(null);
	/** Set once a code has been requested, so the panel stops offering to send another blindly. */
	readonly codeSent = signal(false);
	/** Disables "send again" for the backoff, and says how long is left. */
	readonly resend = new ResendCountdown();

	readonly passwordMinLength = PASSWORD_MIN_LENGTH;
	readonly codeLength = OTP_CODE_LENGTH;

	/** True while the account has no password, which is what turns "Change" into "Set". */
	readonly needsFirstPassword = computed(() => this.methods()?.passwordSet === false);
	readonly stepUpByCode = computed(() => this.methods()?.stepUpMethod === 'otp');

	/**
	 * Which channels a code can reach, as a translation key rather than assembled text.
	 *
	 * Three keys instead of one with a joined list: "email and phone" does not translate by
	 * gluing words together, and every account is meant to have both anyway — the single-channel
	 * keys exist so a row created before that rule still describes itself honestly.
	 */
	readonly oneTimeCodeChannels = computed(() => {
		const view = this.methods();
		if (view?.emailVerified && view?.phoneVerified) return 'one_time_code_email_and_phone';
		if (view?.emailVerified) return 'one_time_code_email_only';
		if (view?.phoneVerified) return 'one_time_code_phone_only';
		return 'one_time_code_no_channel';
	});

	/** Names the dialog after what it is about to do, not generically. */
	readonly stepUpTitle = computed(() => {
		const action = this.pending();
		if (action?.kind === 'password') return this.needsFirstPassword() ? 'set_password' : 'change_password';
		if (action?.kind === 'disconnect') return 'disconnect';
		return 'connect';
	});

	/**
	 * ONE form for the whole dialog.
	 *
	 * Proof and new password together, because they are submitted together. An earlier version
	 * split them across two `<form>` elements inside `.address-box`, whose child is
	 * `display: flex` — so the forms became flex siblings and three stacked fields rendered as a
	 * squashed two-column grid with the fields touching.
	 */
	readonly form: FormGroup;

	constructor() {
		this.form = this.formBuilder.group(
			{
				currentPassword: new FormControl(''),
				code: new FormControl('', [
					Validators.minLength(OTP_CODE_LENGTH),
					Validators.maxLength(OTP_CODE_LENGTH),
					Validators.pattern(/^\d*$/),
				]),
				// Mirrors the server policy so the failure is visible before a round trip. The
				// server remains the authority — this validator is convenience only.
				newPassword: new FormControl('', [Validators.minLength(PASSWORD_MIN_LENGTH)]),
				confirmation: new FormControl(''),
			},
			{ validator: CustomValidators.MatchValidator('newPassword', 'confirmation') },
		);
		void this.load();
	}

	get passwordMatchError(): boolean {
		return this.form.getError('mismatch') && this.form.get('confirmation')?.touched === true;
	}

	private async load(): Promise<void> {
		this.loading.set(true);
		try {
			this.methods.set(await firstValueFrom(this.gateway.loginMethods()));
		} catch (error) {
			this.refusal.set(refusalCode(error));
		} finally {
			this.loading.set(false);
		}
	}

	/** Opens the step-up dialog for an action, rather than performing it immediately. */
	begin(action: PendingAction): void {
		if (!isPlatformBrowser(this.platformId)) return;
		this.resetForm();
		this.pending.set(action);
		this.modalService
			.open(this.stepUpModal(), { ariaLabelledBy: 'step-up-modal', centered: true, windowClass: 'theme-modal' })
			// Dismissing is an ordinary choice, not a failure; it just drops the pending action.
			.result.catch(() => this.pending.set(null));
	}

	/** A provider dialog came back with a credential — now prove it is really them. */
	onCredential(credential: ProviderCredential): void {
		this.begin({ kind: 'connect', credential });
	}

	private resetForm(): void {
		this.codeSent.set(false);
		this.resend.reset();
		this.refusal.set(null);
		this.notice.set(null);
		this.form.reset({ currentPassword: '', code: '', newPassword: '', confirmation: '' });
	}

	/**
	 * Sends a step-up code.
	 *
	 * Only reachable for an account with no password: `stepUpMethod` is the server's decision and
	 * a password, where one exists, is both free to check and stronger than a code delivered to a
	 * channel whoever holds the session may already be reading.
	 */
	async sendCode(channel: 'email' | 'sms'): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		this.refusal.set(null);
		try {
			await firstValueFrom(this.gateway.requestStepUp(channel));
			this.codeSent.set(true);
			this.resend.start();
			this.notice.set('step_up_code_sent');
		} catch (error) {
			this.refusal.set(refusalCode(error));
		} finally {
			this.busy.set(false);
		}
	}

	/** The proof as the API expects it: whichever field the server asked for. */
	private collectProof(): StepUpProof | null {
		if (this.stepUpByCode()) {
			const code = String(this.form.value.code ?? '');
			return code.length === OTP_CODE_LENGTH ? { otpCode: code } : null;
		}
		const password = String(this.form.value.currentPassword ?? '');
		return password.length > 0 ? { password } : null;
	}

	async confirm(): Promise<void> {
		const action = this.pending();
		const proof = this.collectProof();
		if (!action || this.busy()) return;
		if (!proof) {
			this.refusal.set('step_up_required');
			return;
		}
		if (action.kind === 'password') {
			this.form.markAllAsTouched();
			const newPassword = String(this.form.value.newPassword ?? '');
			if (newPassword.length < PASSWORD_MIN_LENGTH || this.form.getError('mismatch')) return;
		}

		this.busy.set(true);
		this.refusal.set(null);
		try {
			const next = await firstValueFrom(this.requestFor(action, proof));
			this.methods.set(next);
			this.pending.set(null);
			this.modalService.dismissAll();
			this.notice.set(NOTICE_FOR[action.kind]);
		} catch (error) {
			this.refusal.set(refusalCode(error));
		} finally {
			this.busy.set(false);
		}
	}

	/** One place an action becomes a call, so `confirm` stays about proof and refusal. */
	private requestFor(action: PendingAction, proof: StepUpProof) {
		switch (action.kind) {
			case 'password':
				return this.gateway.setPassword({ newPassword: String(this.form.value.newPassword ?? ''), ...proof });
			case 'disconnect':
				return this.gateway.disconnectIdentity({ provider: action.provider, ...proof });
			case 'connect':
				return this.gateway.connectIdentity({ ...action.credential, ...proof });
		}
	}
}

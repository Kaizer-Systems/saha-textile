import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { Select2Module, type Select2Option } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { StorefrontAuthGateway, type PendingSignupView } from '@core/auth/auth-gateway';
import { ProviderSdkLoader } from '@core/auth/provider-sdk.loader';
import { refusalCode } from '@core/auth/refusal-code';
import { AuthStore } from '@core/state/auth.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { SocialSignIn } from '@shared/ui/social-sign-in/social-sign-in';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';
import { CustomValidators } from '@shared/validators/password-match';

import * as data from '../../../shared/data/country-code';

/** Owner lock: minimum 12 characters for storefront and admin alike. */
const PASSWORD_MIN_LENGTH = 12;

/**
 * The dial codes the picker offers, longest first so `+1` never wins over `+91`.
 *
 * Read out of the same list the `select2` renders, so the two can never disagree about which
 * codes exist. Groups are filtered out — the list is flat today, and a hand-maintained parallel
 * array would be the thing that goes stale.
 */
const DIAL_CODES: readonly string[] = [
	...new Set(
		data.countryCodes
			.filter((option): option is Select2Option => 'value' in option)
			.map((option) => String(option.value)),
	),
].sort((a, b) => b.length - a.length);

/**
 * Splits an E.164 number back into the two controls that produced it.
 *
 * The API stores one string; the form holds a dial-code picker and a digits field. Resuming a
 * signup after a reload therefore has to undo the join, and it has to try the LONGEST codes
 * first — `+91` and `+1` both prefix an Indian number, and matching the short one leaves a
 * picker set to the United States and eight extra digits in the phone field.
 *
 * An unrecognised prefix keeps the whole value in the digits field rather than guessing. Wrong
 * and visible beats wrong and plausible: the person can see what it is holding and correct it,
 * and the number is re-verified before it can mean anything.
 */
function splitPhone(e164: string): { country_code: string; phone: string } {
	const digits = e164.startsWith('+') ? e164.slice(1) : e164;
	const dialCode = DIAL_CODES.find((code) => digits.startsWith(code) && digits.length > code.length);
	return dialCode
		? { country_code: dialCode, phone: digits.slice(dialCode.length) }
		: { country_code: '91', phone: digits };
}

/**
 * Verified-before-creation registration (`DEC-SIGNUP-VERIFICATION`).
 *
 * ## What this screen does and does not know
 *
 * It RENDERS the server's view of the signup and never asserts one. `pending()` is what the
 * API says has been proven; the form's own controls are only what the person has typed. That
 * split is the security property in UI form — a screen that could claim "verified" would be a
 * screen that could claim somebody else's address.
 *
 * No account exists until both identifiers are proven, so "submit" is the LAST step rather
 * than the only one, and it sends no email or phone at all.
 *
 * ## The screen asks what is already in flight, before it renders anything
 *
 * A Google or Facebook round trip does not begin a signup HERE — it begins one on the server and
 * then hands the browser to this route. The record is keyed to an httpOnly cookie, so the only
 * way to learn about it is to ask, which is what `GET /auth/storefront/signup` exists for.
 *
 * Without that ask this screen rendered an empty form on top of a complete record: no name, no
 * email, a password field a social origin does not require, an invitation to re-type an address
 * Google had just asserted — and the provider buttons still on display INSIDE the signup they had
 * started. Nothing was lost; nothing could be read. Every one of those defects is the same
 * missing question.
 *
 * ## What the origin decides
 *
 * `password` collects one and shows the provider buttons. `google` and `facebook` show neither:
 * a social signup has no password until the customer sets one from their account page, and
 * offering another provider inside a signup already begun by one is an invitation to throw the
 * first one away — clicking it would replace the pending record, and with it the proof already
 * earned.
 */
@Component({
	selector: 'app-register',
	templateUrl: './register.html',
	styleUrls: ['./register.scss'],
	imports: [
		Breadcrumb,
		ReactiveFormsModule,
		Select2Module,
		Button,
		RouterLink,
		TranslocoModule,
		NgbTooltip,
		SocialSignIn,
	],
})
export class Register {
	private authStore = inject(AuthStore);
	private gateway = inject(StorefrontAuthGateway);
	private loader = inject(ProviderSdkLoader);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private platformId = inject<Object>(PLATFORM_ID);

	public form: FormGroup;
	public breadcrumb = translatedBreadcrumb('sign_in');
	public codes = data.countryCodes;
	public tnc = new FormControl(false, [Validators.requiredTrue]);
	public marketingOptIn = new FormControl(false);
	public isBrowser: boolean;

	public readonly error = this.authStore.error;
	public readonly pending = this.authStore.pending;
	public readonly passwordMinLength = PASSWORD_MIN_LENGTH;

	/** The server's answer, or null before a signup has been started. */
	public readonly signup = signal<PendingSignupView | null>(null);
	/** Which field is mid-request, so only that control shows a busy state. */
	public readonly busyField = signal<'email' | 'phone' | null>(null);
	/** Stable refusal code from the API, rendered as a translated message. */
	public readonly refusal = signal<string | null>(null);
	/** Set when a verified identifier turned out to already have an account. */
	public readonly existingAccount = signal(false);
	/** True while the first `GET` is in flight, so the form is not rendered and then rewritten. */
	public readonly loading = signal(false);

	public readonly emailState = computed(() => this.signup()?.email ?? null);
	public readonly phoneState = computed(() => this.signup()?.phone ?? null);
	public readonly canSubmit = computed(() => this.signup()?.complete === true);

	/** How this signup began. Absent one, the screen behaves as the password form it always was. */
	public readonly origin = computed(() => this.signup()?.origin ?? 'password');

	/**
	 * A social signup collects no password, because `finaliseSignup` does not require one.
	 *
	 * Showing the fields anyway made two required controls the person could not satisfy without
	 * inventing a credential nobody asked them for — and the API would have ignored it.
	 */
	public readonly needsPassword = computed(() => this.origin() === 'password');

	/**
	 * The provider buttons belong on an EMPTY registration page and nowhere else.
	 *
	 * Not merely incoherent inside a signup in progress — destructive. `POST /signup/start`
	 * REPLACES the record for this browser, so a Google click halfway through a signup discards
	 * whatever has already been proven, including a phone number the person waited for a code on.
	 */
	public readonly showSocial = computed(() => this.signup() === null);

	/** Google asserted this address, so the form displays it and will not invite a re-entry. */
	public readonly emailLocked = computed(() => this.emailState()?.locked === true);

	/** The provider's own name, through the keys the account screen already translates. */
	public readonly providerKey = computed(() => `provider_${this.origin()}`);

	/**
	 * The account has been created, so the pending record is already spent.
	 *
	 * Read on the way out: leaving this screen normally means abandoning a signup, and leaving it
	 * because the signup SUCCEEDED must not send a `DELETE` for a record the server consumed.
	 */
	private finalised = false;

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.form = this.formBuilder.group(
			{
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				// Phone is now collected AND verified at registration — the earlier
				// collect-at-checkout lock was superseded by `DEC-SIGNUP-VERIFICATION`, because
				// every account carrying two proven channels is what makes recovery robust and
				// disconnecting a social login safe.
				phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl('91'),
				// Mirrors the server policy so the failure is visible before a round trip. The
				// server remains the authority — this validator is convenience only.
				password: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);

		// SSR renders the empty form; only a browser holds the `st_signup` cookie that this
		// question is answered against, so asking on the server would answer "none" every time
		// and then be overwritten on hydration.
		if (this.isBrowser) void this.resume();
	}

	/**
	 * Asks the server what is already in flight, and renders it.
	 *
	 * Runs on every arrival, including a reload, which is what makes the flow survive one. The
	 * alternative — carrying the state across the navigation from the social button — looks
	 * simpler and loses everything the moment anybody presses F5.
	 */
	private async resume(): Promise<void> {
		this.loading.set(true);
		try {
			const pending = await firstValueFrom(this.gateway.currentSignup());
			if (pending) this.adopt(pending);
		} finally {
			this.loading.set(false);
		}
	}

	/**
	 * Renders a server record into the form.
	 *
	 * One direction only: server to form. Nothing here tells the API what is verified, and the
	 * controls it disables are disabled because the SERVER said so — a locked email is Google's
	 * assertion, and the password fields are absent because the origin says they are not
	 * required. A screen that could decide either of those could decide them wrongly.
	 */
	private adopt(pending: PendingSignupView): void {
		this.signup.set(pending);

		// `patchValue`, not `setValue`: the person may already have typed something into a field
		// the server has nothing for, and the answer to a partial record is not an empty form.
		this.form.patchValue({
			name: pending.displayName ?? this.form.getRawValue().name ?? '',
			email: pending.email.value ?? this.form.getRawValue().email ?? '',
		});
		if (pending.phone.value) this.form.patchValue(splitPhone(pending.phone.value));

		this.applyOriginRules(pending);
	}

	/**
	 * Enables or disables the controls the ORIGIN decides, rather than hiding them in the
	 * template alone.
	 *
	 * A hidden-but-enabled required control is a form that can never be valid and never says
	 * why: the submit button stays dead and the page offers no explanation, because the field
	 * doing the refusing is not on screen. Angular excludes disabled controls from validity, so
	 * disabling is what makes the template's `@if` truthful.
	 */
	private applyOriginRules(pending: PendingSignupView): void {
		const password = this.form.get('password');
		const confirmation = this.form.get('password_confirmation');
		if (pending.origin === 'password') {
			password?.enable({ emitEvent: false });
			confirmation?.enable({ emitEvent: false });
		} else {
			password?.disable({ emitEvent: false });
			confirmation?.disable({ emitEvent: false });
		}

		// A locked address is one the provider asserted and we cannot re-verify. Disabling the
		// control is the same statement the `locked` flag makes on the server, in the one place
		// somebody could otherwise type over it.
		const email = this.form.get('email');
		if (pending.email.locked) email?.disable({ emitEvent: false });
		else email?.enable({ emitEvent: false });
	}

	/**
	 * Abandons the signup on the way out of this screen.
	 *
	 * Called by the route's `canDeactivate`, so it fires on an in-app navigation away and NOT on
	 * a reload — Angular runs no teardown when the browser tears the page down itself, which is
	 * exactly the distinction wanted. Refreshing resumes; leaving discards.
	 *
	 * Never blocks the navigation. Somebody who has decided to leave is not asked to wait for a
	 * request they did not make, and the record TTLs out regardless — the `DELETE` only makes the
	 * ending prompt, so that a half-finished signup does not resume days later on a shared
	 * machine showing somebody else's verified address.
	 */
	leaveSignup(): void {
		const pending = this.signup();
		if (this.finalised || !pending) return;
		this.signup.set(null);
		void firstValueFrom(this.gateway.discardSignup());
		void this.revokeAbandonedGoogleGrant(pending);
	}

	/**
	 * Hands Google's consent back when a Google signup is abandoned.
	 *
	 * ## The button that says something untrue
	 *
	 * After a person approves this site, Google's own button stops reading "Sign in with Google"
	 * and starts reading "Sign in as <their name>". Google's documentation gives two conditions
	 * for that: an active Google session, and "a corresponding account on your website who has
	 * signed in using Sign In With Google before". The second one is the problem — the grant is
	 * made when they press the button, and the account is only made when they FINISH. Abandon in
	 * between and the button claims a returning customer who does not exist here.
	 *
	 * There is no way to ask for the plain button while the grant stands. The documented
	 * suppressions are all disfigurements — an icon-only button, `size: 'small'`, a width under
	 * 200px — and this button is deliberately sized to match Meta's beside it.
	 *
	 * ## So the grant goes back, and only in the one case that earned it
	 *
	 * Abandonment is the only moment we know both halves for certain: consent WAS given, and no
	 * account came of it. Finishing keeps the grant, because then "Sign in as…" is simply true.
	 *
	 * `revoke` is scoped to this client. It does NOT sign anybody out of Google — not here, not
	 * in the tab they left open on Gmail. The whole cost is that the next press asks them to pick
	 * an account and approve Saha Textile again, which the owner has weighed and accepted.
	 *
	 * Fire-and-forget: the person has already left, and a failure here leaves a button that
	 * overstates rather than a flow that breaks. The loader configures GIS first if nothing on
	 * this page has — and on this page nothing has, because a resumed social signup hides the
	 * very button that would have done it. Revoking without that step is refused outright, which
	 * is how the first version of this failed: silently, on the only path it exists for.
	 */
	private async revokeAbandonedGoogleGrant(pending: PendingSignupView): Promise<void> {
		if (pending.origin !== 'google' || !pending.email.value) return;
		await this.loader.revokeGoogleGrant(pending.email.value);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
	}

	/**
	 * E.164 for the API; the picker holds the dial code separately from the digits.
	 *
	 * `getRawValue`, not `value`: a disabled control is absent from `value`, and this screen
	 * disables controls the server has locked. Reading `value` would silently send an empty
	 * identifier the moment locking started applying to a field.
	 */
	private phoneValue(): string {
		const raw = this.form.getRawValue();
		return `+${String(raw.country_code ?? '91')}${String(raw.phone ?? '')}`;
	}

	/** Same reasoning: a Google email is locked, and locked controls are disabled. */
	private emailValue(): string {
		return String(this.form.getRawValue().email ?? '');
	}

	/**
	 * Starts or resumes the signup, then sends a code for one field.
	 *
	 * Starting is idempotent per browser: the server keys the pending record on a cookie, so a
	 * second tab continues the same signup rather than racing it.
	 */
	async verify(field: 'email' | 'phone'): Promise<void> {
		const control = this.form.get(field);
		control?.markAsTouched();
		if (control?.invalid || this.busyField()) return;

		this.busyField.set(field);
		this.refusal.set(null);
		try {
			if (!this.signup()) {
				this.adopt(
					await firstValueFrom(
						this.gateway.startSignup({
							email: this.emailValue(),
							phone: this.phoneValue(),
							displayName: String(this.form.getRawValue().name ?? '') || undefined,
							marketingOptIn: this.marketingOptIn.value === true,
						}),
					),
				);
			} else {
				// Editing clears that field's proof server-side, which is why the value is sent
				// before the code rather than alongside it.
				const value = field === 'email' ? this.emailValue() : this.phoneValue();
				this.adopt(await firstValueFrom(this.gateway.updateSignupField(field, value)));
			}
			this.adopt(await firstValueFrom(this.gateway.requestSignupOtp(field)));
		} catch (error) {
			this.refusal.set(refusalCode(error, 'registration_failed'));
		} finally {
			this.busyField.set(null);
		}
	}

	/**
	 * Submits a code for one field.
	 *
	 * A successful verification may reveal that the identifier already belongs to an account —
	 * safe to say only because the person just proved they control it. The screen offers sign-in
	 * rather than letting them finish the form and be refused at the end.
	 */
	async submitCode(field: 'email' | 'phone', code: string): Promise<void> {
		if (this.busyField()) return;
		this.busyField.set(field);
		this.refusal.set(null);
		try {
			const result = await firstValueFrom(this.gateway.verifySignupOtp(field, code));
			this.adopt(result.state);
			if (result.existingAccount) {
				this.existingAccount.set(true);
				// A disabled or locked account is not enterable even by its owner, so the screen
				// must not offer a sign-in that would be refused.
				this.refusal.set(result.accountUsable ? 'signup_identifier_taken' : 'account_not_accessible');
			}
		} catch (error) {
			this.refusal.set(refusalCode(error, 'registration_failed'));
		} finally {
			this.busyField.set(null);
		}
	}

	/**
	 * Creates the account.
	 *
	 * Sends only the password. Every identifier comes from what the server verified, so there is
	 * nothing here for a tampered form to substitute at the moment an account is minted.
	 */
	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (this.tnc.invalid || !this.canSubmit() || this.pending()) return;

		this.refusal.set(null);
		// Undefined rather than an empty string for a social origin: the API branches on whether
		// a password is PRESENT, and `''` is present. Sending one would fail the length policy
		// for a credential the flow never asked anybody to choose.
		const password = this.needsPassword() ? String(this.form.getRawValue().password ?? '') : undefined;
		const created = await this.authStore.finaliseSignup(password);
		if (!created) return;

		// The record is spent, so leaving this screen must not try to abandon it.
		this.finalised = true;
		await this.router.navigateByUrl('/account/dashboard');
	}
}

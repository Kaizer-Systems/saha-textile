import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { StorefrontAuthGateway, type PendingSignupView } from '@core/auth/auth-gateway';
import { ProviderSdkLoader } from '@core/auth/provider-sdk.loader';
import { AuthStore } from '@core/state/auth.store';

import { Register } from './register';

/**
 * What the screen does with the record the SERVER is holding.
 *
 * The defect this file is written against was singular and produced four symptoms at once: a
 * social round trip left a fully populated pending signup on the API — verified email, display
 * name, provider subject — and this screen had no way to ask for it. So it rendered an empty
 * form, with password fields a social origin does not need, an editable copy of an address
 * Google had just asserted, and the provider buttons still on offer inside the signup they had
 * begun.
 *
 * Every case below therefore starts from a server record and asserts what the form became. What
 * these cases do NOT prove is that a provider dialog opens or that a popup survives a user
 * gesture — no test in jsdom can, and reporting one as if it could is how this shipped. Those
 * belong in a browser, end to end, with the database read before and after.
 */

/** Google's answer: an address it asserts, hence verified and locked, and no phone. */
const GOOGLE_PENDING: PendingSignupView = {
	origin: 'google',
	email: {
		value: 'someone@example.com',
		verified: true,
		locked: true,
		sendsRemaining: 5,
		resendAvailableAt: null,
	},
	phone: { value: null, verified: false, locked: false, sendsRemaining: 5, resendAvailableAt: null },
	displayName: 'Someone Example',
	complete: false,
	expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

const PASSWORD_PENDING: PendingSignupView = {
	...GOOGLE_PENDING,
	origin: 'password',
	email: { ...GOOGLE_PENDING.email, verified: false, locked: false },
	phone: { ...GOOGLE_PENDING.phone, value: '+919876543210' },
};

interface Harness {
	component: Register;
	discard: ReturnType<typeof vi.fn>;
	finalise: ReturnType<typeof vi.fn>;
	navigate: ReturnType<typeof vi.fn>;
	/** Google grants handed back, by the account hint they were revoked for. */
	revoked: string[];
}

/**
 * The real template renders a breadcrumb, a `select2` picker and Google's own button, none of
 * which survives jsdom or says anything about which record the form adopted. The stand-in keeps
 * the component's own bindings reachable and nothing else.
 */
const TEMPLATE_STAND_IN = '<div></div>';

function harness(pending: PendingSignupView | null): Harness {
	const result = {
		discard: vi.fn(() => of(undefined)),
		finalise: vi.fn().mockResolvedValue(true),
		navigate: vi.fn().mockResolvedValue(true),
		revoked: [] as string[],
	} as unknown as Harness;

	const loader = {
		revokeGoogleGrant: async (hint: string) => {
			result.revoked.push(hint);
			return true;
		},
	};

	const gateway = {
		currentSignup: () => of(pending),
		discardSignup: result.discard,
		startSignup: () => of(pending),
		updateSignupField: () => of(pending),
		requestSignupOtp: () => of(pending),
		verifySignupOtp: () => of({ state: pending, existingAccount: false, accountUsable: true }),
	};

	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [Register],
		providers: [
			{ provide: StorefrontAuthGateway, useValue: gateway },
			{ provide: ProviderSdkLoader, useValue: loader },
			{
				provide: AuthStore,
				useValue: {
					error: () => null,
					pending: () => false,
					finaliseSignup: result.finalise,
				},
			},
			{ provide: Router, useValue: { navigateByUrl: result.navigate } },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('Sign in') } },
		],
	});
	TestBed.overrideComponent(Register, { set: { template: TEMPLATE_STAND_IN } });

	const fixture = TestBed.createComponent(Register);
	fixture.detectChanges();
	result.component = fixture.componentInstance;
	return result;
}

/** Lets the resume promise settle before the assertions read the form. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the screen renders the signup the server is already holding', () => {
	it('prefills the name and the address a provider asserted', async () => {
		const h = harness(GOOGLE_PENDING);
		await settle();

		const raw = h.component.form.getRawValue();
		expect(raw.name).toBe('Someone Example');
		expect(raw.email).toBe('someone@example.com');
		expect(h.component.origin()).toBe('google');
	});

	/**
	 * Disabled, not merely hidden. Angular excludes disabled controls from validity, so this is
	 * what stops a field nobody can see from holding the submit button down with a `required`
	 * error the page has no way to display.
	 */
	it('drops the password fields for a social origin', async () => {
		const h = harness(GOOGLE_PENDING);
		await settle();

		expect(h.component.needsPassword()).toBe(false);
		expect(h.component.form.get('password')?.disabled).toBe(true);
		expect(h.component.form.get('password_confirmation')?.disabled).toBe(true);
	});

	it('locks the address the provider asserted', async () => {
		const h = harness(GOOGLE_PENDING);
		await settle();

		expect(h.component.emailLocked()).toBe(true);
		expect(h.component.form.get('email')?.disabled).toBe(true);
	});

	/**
	 * `POST /signup/start` REPLACES the record for this browser, so a provider button pressed
	 * inside a signup in progress discards whatever has already been proven. Hiding it is not
	 * tidiness.
	 */
	it('offers no provider buttons inside a signup already in flight', async () => {
		const h = harness(GOOGLE_PENDING);
		await settle();

		expect(h.component.showSocial()).toBe(false);
	});

	it('keeps the password form intact when the signup began with one', async () => {
		const h = harness(PASSWORD_PENDING);
		await settle();

		expect(h.component.needsPassword()).toBe(true);
		expect(h.component.form.get('password')?.enabled).toBe(true);
		expect(h.component.form.get('email')?.enabled).toBe(true);
		// The API stores one E.164 string; the form holds a dial-code picker and a digits field.
		// Matching the longest code first is what keeps `+91` from being read as `+9`.
		expect(h.component.form.getRawValue().country_code).toBe('91');
		expect(h.component.form.getRawValue().phone).toBe('9876543210');
	});

	it('renders the ordinary empty form when nothing is in flight', async () => {
		const h = harness(null);
		await settle();

		expect(h.component.signup()).toBeNull();
		expect(h.component.needsPassword()).toBe(true);
		expect(h.component.showSocial()).toBe(true);
	});
});

describe('finalisation sends only what the origin requires', () => {
	it('sends no password at all for a social origin', async () => {
		const h = harness({ ...GOOGLE_PENDING, complete: true });
		await settle();
		h.component.tnc.setValue(true);

		await h.component.submit();

		// `undefined`, not `''`. The API branches on whether a password is PRESENT, and an empty
		// string is present — it would be measured against the length policy and refused, for a
		// credential this flow never asked anybody to choose.
		expect(h.finalise).toHaveBeenCalledWith(undefined);
	});

	it('sends the typed password when the signup began with one', async () => {
		const h = harness({ ...PASSWORD_PENDING, complete: true });
		await settle();
		h.component.tnc.setValue(true);
		h.component.form.get('password')?.setValue('a-very-long-password');

		await h.component.submit();

		expect(h.finalise).toHaveBeenCalledWith('a-very-long-password');
	});
});

describe('leaving abandons the signup; finishing does not', () => {
	it('discards the record on the way out', async () => {
		const h = harness(GOOGLE_PENDING);
		await settle();

		h.component.leaveSignup();

		expect(h.discard).toHaveBeenCalledTimes(1);
	});

	/**
	 * The grant is what makes Google's button read "Sign in as <name>", and Google gives no way
	 * to ask for the plain one while it stands. Abandonment is the single moment we know consent
	 * was given and no account came of it — so it is the single moment the grant goes back.
	 *
	 * `revoke` is scoped to this client: it hands back an approval, it does not sign anybody out
	 * of Google.
	 */
	it('hands back the Google grant, so the button stops claiming a customer', async () => {
		const h = harness(GOOGLE_PENDING);
		await settle();

		h.component.leaveSignup();
		await settle();

		expect(h.revoked).toEqual(['someone@example.com']);
	});

	it('leaves the grant alone when the signup did not come from Google', async () => {
		const h = harness(PASSWORD_PENDING);
		await settle();

		h.component.leaveSignup();
		await settle();

		expect(h.revoked).toEqual([]);
	});

	it('discards nothing when there was no signup to abandon', async () => {
		const h = harness(null);
		await settle();

		h.component.leaveSignup();

		expect(h.discard).not.toHaveBeenCalled();
	});

	/** The record was consumed at finalisation; a `DELETE` afterwards addresses nothing. */
	it('discards nothing after the account has been created', async () => {
		const h = harness({ ...GOOGLE_PENDING, complete: true });
		await settle();
		h.component.tnc.setValue(true);
		await h.component.submit();

		h.component.leaveSignup();

		expect(h.navigate).toHaveBeenCalledWith('/account/dashboard');
		expect(h.discard).not.toHaveBeenCalled();
		// And the grant stays: "Sign in as <name>" is true once the account exists.
		expect(h.revoked).toEqual([]);
	});
});

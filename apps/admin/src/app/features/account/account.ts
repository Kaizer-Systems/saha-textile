import { isPlatformBrowser, AsyncPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, PLATFORM_ID, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { AdminAuthGateway, type AdminSecurityState } from '@core/auth/auth-gateway';
import { AccountStore } from '@core/state/account.store';
import { AuthStore } from '@core/state/auth.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import * as data from '@shared/data/country-code';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';
import { PinPad } from '@shared/ui/pin-pad/pin-pad';
import { CustomValidators } from '@shared/validators/password-match';

/** Owner lock 2026-06-29 / UX lock 2026-07-23. Mirrors the login screen rather than redefining. */
const PIN_LENGTH = 6;

/** The Security tab's three panes. Ids are the Transloco keys the pills render. */
type SecurityView = 'credential_status' | 'pin' | 'password';

/** Owner lock 2026-06-29. The server is the authority; this only spares a round-trip. */
const PASSWORD_MIN_LENGTH = 12;

@Component({
	selector: 'app-account',
	templateUrl: './account.html',
	styleUrls: ['./account.scss'],
	imports: [
		PageWrapper,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		ReactiveFormsModule,
		FormFields,
		ImageUpload,
		Select2Module,
		Button,
		NgbNavOutlet,
		TranslocoModule,
		AsyncPipe,
		DatePipe,
		PinPad,
		ConfirmationModal,
	],
})
export class Account {
	private formBuilder = inject(FormBuilder);
	private accountStore = inject(AccountStore);
	private gateway = inject(AdminAuthGateway);
	private notificationService = inject(NotificationService);
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private transloco = inject(TranslocoService);

	private readonly countriesQuery = injectCountriesQuery();
	private readonly statesQuery = injectStatesQuery();
	private readonly selectedCountryId = signal<number | null>(null);

	user$: Observable<IAccountUser | null> = toObservable(this.accountStore.user);
	countries$: Observable<Select2Data> = toObservable(
		computed(
			() => this.countriesQuery.data()?.map((country) => ({ label: country.name, value: country.id })) ?? [],
		),
	);
	roleName$: Observable<string | null> = toObservable(this.accountStore.roleName);

	public active = 'profile';
	public profileForm: FormGroup;
	/** Password proof for the PIN operations. Separate from the password-change form below. */
	public securityForm: FormGroup;
	public securityPasswordForm: FormGroup;
	public form: FormGroup;
	public codes = data.countryCodes;
	states$: Observable<Select2Data> = toObservable(computed(() => this.filterStates(this.selectedCountryId())));
	public flicker: boolean = false;
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
		this.user$.subscribe((user) => {
			this.profileForm = this.formBuilder.group({
				name: new FormControl(user?.name, [Validators.required]),
				email: new FormControl(user?.email, [Validators.required, Validators.email]),
				phone: new FormControl(user?.phone, [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl(user?.country_code, [Validators.required]),
				profile_image_id: new FormControl(user?.profile_image_id),
			});

			this.flicker = true;

			if (user && user.store) {
				this.form = this.formBuilder.group({
					store_name: new FormControl(user.store.store_name, [Validators.required]),
					description: new FormControl(user.store.description, [Validators.required]),
					country_id: new FormControl(user.store?.country_id, [Validators.required]),
					state_id: new FormControl(user?.store?.state_id, [Validators.required]),
					city: new FormControl(user?.store?.city, [Validators.required]),
					address: new FormControl(user?.store?.address, [Validators.required]),
					pincode: new FormControl(user?.store?.pincode, [Validators.required]),
					store_logo_id: new FormControl(user?.store?.store_logo_id),
					hide_vendor_email: new FormControl(user?.store?.hide_vendor_email),
					hide_vendor_phone: new FormControl(user?.store?.hide_vendor_phone),
					facebook: new FormControl(user?.store?.facebook),
					instagram: new FormControl(user?.store?.instagram),
					pinterest: new FormControl(user?.store?.pinterest),
					youtube: new FormControl(user?.store?.youtube),
					twitter: new FormControl(user?.store?.twitter),
				});
			}

			setTimeout(() => (this.flicker = false), 200);
		});

		this.securityForm = this.formBuilder.group({
			current_password: new FormControl('', [Validators.required]),
		});

		// The 12-character floor is the owner-locked password policy, and the server enforces
		// it regardless. Declaring it here too is a courtesy to the operator — a refusal after
		// a round-trip for something the form already knew is a worse experience than a hint.
		this.securityPasswordForm = this.formBuilder.group(
			{
				current_password: new FormControl('', [Validators.required]),
				password: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	countryChange(data: Select2UpdateEvent) {
		if (data && data?.value) {
			this.selectedCountryId.set(+data?.value);
			this.form.controls['state_id'].setValue('');
		} else {
			this.form.controls['state_id'].setValue('');
		}
	}

	// Replicates the former StateState.states selector: states optionally filtered by country.
	private filterStates(country_id?: number | null): Select2Data {
		const states = this.statesQuery.data() ?? [];
		const filtered = country_id ? states.filter((element) => element.country_id == country_id) : states;
		return filtered.map((st) => ({ label: st?.name, value: st?.id, country_id: st?.country_id })) as Select2Data;
	}

	selectCode(data: Select2UpdateEvent) {
		this.profileForm.controls['country_code'].setValue(data?.value);
	}

	selectedFiles(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.profileForm.controls['profile_image_id'].setValue(data ? data.id : '');
		}
	}

	profileFormSubmit() {
		this.profileForm.markAllAsTouched();
		if (this.profileForm.valid) {
			// Update has no backend yet — profile value is ready to persist once the API exists.
		}
	}

	selectStoreLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['store_logo_id'].setValue(data ? data.id : '');
		}
	}

	updateStore() {
		// Update has no backend yet — store value is ready to persist once the API exists.
	}

	// ---------------------------------------------------------------------------------------
	// Security tab
	//
	// The one part of this screen backed by a real API. Profile and store above are still
	// template-derived placeholders with no endpoint; everything below talks to
	// `/auth/admin/**` through the gateway and must be read as live behaviour, not scaffolding.
	// ---------------------------------------------------------------------------------------

	/** Server-reported credential state. `null` until the first read resolves. */
	readonly security = signal<AdminSecurityState | null>(null);

	/**
	 * Which of the three Security panes is showing.
	 *
	 * Status, PIN and password were one scrolling column with two Save buttons in it. Three
	 * panes means one primary action at a time, and it is why the credential-status pane can
	 * have no button at all — there is nothing in it to submit.
	 */
	readonly securityView = signal<SecurityView>('credential_status');

	readonly pinLength = PIN_LENGTH;
	readonly pin = signal<string>('');
	readonly confirmPin = signal<string>('');
	readonly preferPin = signal<boolean>(false);

	/** Set while a PIN or password mutation is in flight, so a form cannot be submitted twice. */
	readonly securityBusy = signal<boolean>(false);

	/** The last refusal, rendered against the form rather than raised as a second toast. */
	readonly securityError = signal<string | null>(null);

	/**
	 * The signed-in operator's address, for the hidden `autocomplete="username"` field every
	 * password form needs so a password manager can attach the credential to the right
	 * account. Read from the session store rather than the profile form, because the profile
	 * tab is still template-derived placeholder data and would name the wrong account.
	 */
	readonly signedInEmail = this.authStore.email;

	/**
	 * The lock and the suspension are surfaced separately on purpose. `pinLockedUntil` is the
	 * five-failure brute-force lock and expires on its own; `pinRevalidationRequiredAt` follows
	 * a privileged password reset and clears only when the new password is used. An operator
	 * has to be told which one they are in, because the remedies differ.
	 */
	readonly pinLocked = computed(() => {
		const until = this.security()?.pinLockedUntil;
		return until !== null && until !== undefined && new Date(until).getTime() > Date.now();
	});

	readonly pinSuspended = computed(() => this.security()?.pinRevalidationRequiredAt != null);

	readonly pinMismatch = computed(
		() => this.confirmPin().length === this.pinLength && this.pin() !== this.confirmPin(),
	);

	readonly pinReady = computed(() => this.pin().length === this.pinLength && this.pin() === this.confirmPin());

	/**
	 * Loads credential state when the Security tab is opened, not when the screen mounts.
	 *
	 * Mounting fired `/auth/admin/security` on every visit to My Account, including operators
	 * who only ever open Profile — a request nobody asked for, and one whose failure produced
	 * two error toasts over the Profile tab. Loading on activation ties the request to the
	 * intent, and re-running it after a mutation keeps the displayed state honest.
	 */
	onTabChange(tabId: string): void {
		if (tabId === 'security' && this.security() === null) this.loadSecurity();
	}

	/**
	 * Leaving a Security pane discards what was typed into it.
	 *
	 * Both credential panes carry a `current_password` proof and share one `securityError`, so
	 * without this a refusal raised by the PIN pane renders under the password pane's field and
	 * reads as the rejection of a request that was never sent. The proof itself is a credential:
	 * leaving it sitting in a form the operator has navigated away from buys nothing.
	 *
	 * `securityBusy` is deliberately untouched — a mutation in flight is still in flight, and
	 * clearing the flag here would let a second submission overtake it.
	 */
	onSecurityViewChange(view: string): void {
		this.securityView.set(view === 'pin' || view === 'password' ? view : 'credential_status');
		this.securityError.set(null);
		this.securityForm.reset();
		this.securityPasswordForm.reset();
		this.pin.set('');
		this.confirmPin.set('');
	}

	loadSecurity(): void {
		this.gateway.securitySettings().subscribe({
			next: (state) => {
				this.security.set(state);
				this.preferPin.set(state.preferredLoginMethod === 'pin');
			},
			// A read failure leaves the section in its `null` state rather than inventing one.
			// Rendering "no PIN" for an account that has one would invite an operator to set a
			// second credential they did not ask for.
			error: (error: HttpErrorResponse) => this.reportSecurityError(error),
		});
	}

	savePin(): void {
		this.securityForm.markAllAsTouched();
		if (!this.securityForm.valid || !this.pinReady() || this.securityBusy()) return;

		this.securityError.set(null);
		this.securityBusy.set(true);
		this.gateway
			.setPin({
				currentPassword: this.securityForm.controls['current_password'].value,
				pin: this.pin(),
				preferredLoginMethod: this.preferPin() ? 'pin' : 'password',
			})
			.subscribe({
				next: () => {
					this.notificationService.showSuccess(this.transloco.translate('pin_saved'));
					this.resetPinEntry();
					this.loadSecurity();
				},
				error: (error: HttpErrorResponse) => {
					this.securityBusy.set(false);
					this.reportSecurityError(error);
				},
			});
	}

	/**
	 * Confirmed through the shared confirmation modal first: removing a PIN is a credential
	 * deletion, and the password typed into the form above is the proof that authorizes it.
	 */
	removePin(): void {
		if (!this.securityForm.controls['current_password'].value || this.securityBusy()) {
			this.securityForm.markAllAsTouched();
			return;
		}

		this.securityError.set(null);
		this.securityBusy.set(true);
		this.gateway.removePin(this.securityForm.controls['current_password'].value).subscribe({
			next: () => {
				this.notificationService.showSuccess(this.transloco.translate('pin_removed'));
				this.resetPinEntry();
				this.loadSecurity();
			},
			error: (error: HttpErrorResponse) => {
				this.securityBusy.set(false);
				this.reportSecurityError(error);
			},
		});
	}

	/**
	 * Changing the password revokes every admin session INCLUDING this one, so there is no
	 * "saved" state to return to — the operator is signed out by the time the response lands.
	 * Sending them to the login screen is the honest end of the flow; leaving the shell mounted
	 * would show a back office over a session that no longer exists.
	 */
	changeAdminPassword(): void {
		this.securityPasswordForm.markAllAsTouched();
		if (!this.securityPasswordForm.valid || this.securityBusy()) return;

		this.securityError.set(null);
		this.securityBusy.set(true);
		this.gateway
			.changePassword({
				currentPassword: this.securityPasswordForm.controls['current_password'].value,
				newPassword: this.securityPasswordForm.controls['password'].value,
			})
			.subscribe({
				next: () => {
					this.securityPasswordForm.reset();
					this.authStore.clear();
					void this.router.navigate(['/auth/login']);
				},
				error: (error: HttpErrorResponse) => {
					this.securityBusy.set(false);
					this.reportSecurityError(error);
				},
			});
	}

	get securityPasswordMatchError() {
		return (
			this.securityPasswordForm?.getError('mismatch') &&
			this.securityPasswordForm?.get('password_confirmation')?.touched
		);
	}

	private resetPinEntry(): void {
		this.securityForm.reset();
		this.pin.set('');
		this.confirmPin.set('');
		this.securityBusy.set(false);
	}

	/**
	 * Turns an API refusal into something an operator can act on, IN THE FORM.
	 *
	 * Deliberately does not raise a toast. `GlobalErrorHandlerInterceptor` already shows one
	 * for every non-401 response, so doing it here too put two on screen for one failure —
	 * which is exactly what happened the first time this screen was opened in a browser.
	 *
	 * What the toast cannot do is say anything useful: the API's safe message is chosen by
	 * status, so a weak PIN arrives as "The request could not be processed". The specific
	 * reason travels in `issues`, and it belongs against the field it is about rather than in
	 * a corner of the screen. The weak-PIN rule itself is not duplicated here — the server's
	 * message is rendered verbatim, because a second copy of the policy would drift from the
	 * first.
	 *
	 * A `403` is the recent-password proof failing. It does NOT mean the session died, which
	 * is the whole reason the API answers 403 rather than 401.
	 */
	private reportSecurityError(error: HttpErrorResponse): void {
		const issue = error.error?.error?.issues?.[0]?.message;
		if (issue) {
			this.securityError.set(issue);
			return;
		}
		this.securityError.set(
			error.status === 403
				? this.transloco.translate('current_password_is_incorrect')
				: (error.error?.error?.message ?? this.transloco.translate('something_went_wrong_please_try_again')),
		);
	}
}

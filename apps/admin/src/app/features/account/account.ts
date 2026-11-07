import { isPlatformBrowser, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, PLATFORM_ID, inject, signal } from '@angular/core';
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

import { AdminAuthGateway, type AdminSecurityState, type AdminSessionSummary } from '@core/auth/auth-gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
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
		Button,
		NgbNavOutlet,
		TranslocoModule,
		DatePipe,
		PinPad,
		ConfirmationModal,
	],
})
export class Account {
	private formBuilder = inject(FormBuilder);
	private gateway = inject(AdminAuthGateway);
	private notificationService = inject(NotificationService);
	private authStore = inject(AuthStore);
	private router = inject(Router);
	private transloco = inject(TranslocoService);

	public active = 'profile';
	public profileForm: FormGroup;
	/** Password proof for the PIN operations. Separate from the password-change form below. */
	public securityForm: FormGroup;
	public securityPasswordForm: FormGroup;
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);
		this.isBrowser = isPlatformBrowser(platformId);

		const user = this.authStore.user();
		this.profileForm = this.formBuilder.group({
			displayName: new FormControl(user?.displayName || user?.username || '', [Validators.required]),
			email: new FormControl({ value: user?.email ?? '', disabled: true }),
			username: new FormControl({ value: user?.username ?? '', disabled: true }),
			phone: new FormControl(user?.phone ?? ''),
		});

		this.securityForm = this.formBuilder.group({
			current_password: new FormControl('', [Validators.required]),
		});

		this.securityPasswordForm = this.formBuilder.group(
			{
				current_password: new FormControl('', [Validators.required]),
				password: new FormControl('', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH)]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	readonly profileInitial = computed(() => {
		const name = this.authStore.user()?.displayName || this.authStore.user()?.username || this.authStore.email();
		return (name?.charAt(0) ?? '?').toUpperCase();
	});

	profileFormSubmit() {
		this.profileForm.markAllAsTouched();
		if (!this.profileForm.valid) return;
		const displayName = this.profileForm.controls['displayName'].value as string;
		const phoneRaw = String(this.profileForm.controls['phone'].value ?? '').trim();
		this.gateway.updateProfile({ displayName, phone: phoneRaw || null }).subscribe({
			next: () => {
				void this.authStore.bootstrap();
				this.notificationService.showSuccess(this.transloco.translate('profile_updated'));
			},
			error: (error: HttpErrorResponse) => this.reportSecurityError(error),
		});
	}

	// ---------------------------------------------------------------------------------------
	// Security tab
	// ---------------------------------------------------------------------------------------

	readonly security = signal<AdminSecurityState | null>(null);
	readonly sessions = signal<AdminSessionSummary[]>([]);
	readonly sessionsBusy = signal(false);

	readonly securityView = signal<SecurityView>('credential_status');

	readonly pinLength = PIN_LENGTH;
	readonly pin = signal<string>('');
	readonly confirmPin = signal<string>('');
	readonly preferPin = signal<boolean>(false);

	readonly securityBusy = signal<boolean>(false);
	readonly securityError = signal<string | null>(null);

	readonly signedInEmail = this.authStore.email;

	readonly pinLocked = computed(() => {
		const until = this.security()?.pinLockedUntil;
		return until !== null && until !== undefined && new Date(until).getTime() > Date.now();
	});

	readonly pinSuspended = computed(() => this.security()?.pinRevalidationRequiredAt != null);

	readonly pinMismatch = computed(
		() => this.confirmPin().length === this.pinLength && this.pin() !== this.confirmPin(),
	);

	readonly pinReady = computed(() => this.pin().length === this.pinLength && this.pin() === this.confirmPin());

	onTabChange(tabId: string): void {
		if (tabId === 'security' && this.security() === null) this.loadSecurity();
	}

	onSecurityViewChange(view: string): void {
		this.securityView.set(view === 'pin' || view === 'password' ? view : 'credential_status');
		this.securityError.set(null);
		this.securityForm.reset();
		this.securityPasswordForm.reset();
		this.pin.set('');
		this.confirmPin.set('');
		if (this.securityView() === 'credential_status') {
			this.loadSessions();
		}
	}

	loadSecurity(): void {
		this.gateway.securitySettings().subscribe({
			next: (state) => {
				this.security.set(state);
				this.preferPin.set(state.preferredLoginMethod === 'pin');
				this.loadSessions();
			},
			error: (error: HttpErrorResponse) => this.reportSecurityError(error),
		});
	}

	loadSessions(): void {
		this.gateway.listSessions().subscribe({
			next: (items) => this.sessions.set(items),
			error: (error: HttpErrorResponse) => this.reportSecurityError(error),
		});
	}

	revokeSession(session: AdminSessionSummary): void {
		if (this.sessionsBusy()) return;
		this.sessionsBusy.set(true);
		this.gateway.revokeSession(session.id).subscribe({
			next: () => {
				this.sessionsBusy.set(false);
				if (session.current) {
					this.authStore.clear();
					void this.router.navigate(['/auth/login']);
					return;
				}
				this.notificationService.showSuccess(this.transloco.translate('session_revoked'));
				this.loadSecurity();
			},
			error: (error: HttpErrorResponse) => {
				this.sessionsBusy.set(false);
				this.reportSecurityError(error);
			},
		});
	}

	revokeOtherSessions(): void {
		if (this.sessionsBusy()) return;
		this.sessionsBusy.set(true);
		this.gateway.revokeOtherSessions().subscribe({
			next: (result) => {
				this.sessionsBusy.set(false);
				this.notificationService.showSuccess(
					this.transloco.translate('other_sessions_revoked', { count: result.revoked }),
				);
				this.loadSecurity();
			},
			error: (error: HttpErrorResponse) => {
				this.sessionsBusy.set(false);
				this.reportSecurityError(error);
			},
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

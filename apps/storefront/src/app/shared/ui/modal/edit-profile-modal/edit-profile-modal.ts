import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2Module } from 'ng-select2-component';
import { Observable, firstValueFrom } from 'rxjs';

import { StorefrontAuthGateway } from '@core/auth/auth-gateway';
import { refusalCode } from '@core/auth/refusal-code';
import { ResendCountdown } from '@core/auth/resend-countdown';
import { AccountStore } from '@core/state/account.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { ContactChangeService, type PendingContactChange } from '@data-access/services/contact-change.service';
import * as data from '@shared/data/country-code';

import { Button } from '../../button/button';

/** Owner lock: six-digit CSPRNG code, 10-minute expiry, five attempts. */
const OTP_CODE_LENGTH = 6;

/** Which credential the person is moving, once they have asked to move one. */
type ContactField = 'email' | 'phone';

/**
 * Edit profile — the display name inline, the login credentials through a proof.
 *
 * ## Why email and phone are no longer read-only
 *
 * They were shown disabled because `PATCH /storefront/account/profile` takes `displayName` alone
 * and would have ignored them silently. It still does; the credentials now go through
 * `ContactChangeService` instead, which is the flow the security matrix asks for.
 *
 * ## Nothing changes until the code is proven
 *
 * Asking to change an address does not change it. The server sends a code to the NEW value and
 * keeps the old one live — still signing in, still receiving recovery mail — until that code
 * comes back. So this screen shows the account's CURRENT values right up until confirmation, and
 * does not optimistically render what was typed as though it had taken effect.
 *
 * ## Which proof is asked for is the server's decision
 *
 * `stepUpMethod` decides: the current password where one exists, a one-time code where none does
 * — which is every social-only account until it sets one. The screen does not guess, for the same
 * reason the account-security screen does not: a client-side copy of that rule is a second
 * implementation free to disagree with the one that actually enforces it.
 */
@Component({
	selector: 'app-edit-profile-modal',
	templateUrl: './edit-profile-modal.html',
	styleUrls: ['./edit-profile-modal.scss'],
	imports: [Button, ReactiveFormsModule, Select2Module, TranslocoModule],
})
export class EditProfileModal {
	private modalService = inject(NgbModal);
	private accountStore = inject(AccountStore);
	private platformId = inject<Object>(PLATFORM_ID);
	private formBuilder = inject(FormBuilder);
	private contactChange = inject(ContactChangeService);
	private authGateway = inject(StorefrontAuthGateway);

	user$: Observable<IAccountUser> = toObservable(this.accountStore.user) as Observable<IAccountUser>;

	public form: FormGroup;
	public closeResult: string;

	public modalOpen: boolean = false;
	public flicker: boolean = false;
	public codes = data.countryCodes;
	public isBrowser: boolean;

	readonly codeLength = OTP_CODE_LENGTH;
	readonly resend = new ResendCountdown();

	/** Which credential is being moved. Null while the person is only editing their name. */
	readonly changingField = signal<ContactField | null>(null);
	/** The change the SERVER is holding. Null until a start succeeds. */
	readonly pendingChange = signal<PendingContactChange | null>(null);
	/** How the account must prove itself, read from the server rather than guessed. */
	readonly stepUpMethod = signal<'password' | 'otp'>('password');
	readonly refusal = signal<string | null>(null);
	readonly notice = signal<string | null>(null);
	readonly busy = signal(false);

	readonly stepUpByCode = computed(() => this.stepUpMethod() === 'otp');
	/** True once a code is in flight to the new value — the screen is then waiting for it. */
	readonly awaitingCode = computed(() => this.pendingChange() !== null);

	readonly ProfileModal = viewChild<TemplateRef<string>>('profileModal');

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.user$.subscribe((user) => {
			this.flicker = true;
			this.form = this.formBuilder.group({
				name: new FormControl(user?.name, [Validators.required]),
				email: new FormControl(user?.email, [Validators.required, Validators.email]),
				phone: new FormControl(user?.phone, [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl(user?.country_code),
				profile_image_id: new FormControl(user?.profile_image_id),
				/** Step-up: exactly one of these applies, chosen by `stepUpMethod`. */
				currentPassword: new FormControl(''),
				stepUpCode: new FormControl(''),
				/** The code sent to the NEW value, at the second step. */
				confirmationCode: new FormControl(''),
			});
			setTimeout(() => (this.flicker = false), 200);
		});
	}

	openModal() {
		if (!isPlatformBrowser(this.platformId)) return;

		this.modalOpen = true;
		// Opened FIRST, then filled in. Awaiting the two reads before opening would leave the
		// click with nothing to show for it while they were in flight — and would leave the
		// dialog unopenable altogether if either one hung. Neither is needed to edit the name,
		// which is what most people came for.
		void this.loadState();
		this.modalService
			.open(this.ProfileModal(), {
				ariaLabelledBy: 'profile-Modal',
				centered: true,
				windowClass: 'theme-modal',
			})
			.result.then(
				(result) => {
					`Result ${result}`;
				},
				(reason) => {
					this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
				},
			);
	}

	/**
	 * Picks up whatever the server is already holding.
	 *
	 * A change in flight survives a reload, a closed tab and a different device, because it lives
	 * on the server rather than in this component. Reopening the dialog therefore has to ask
	 * rather than assume it is starting fresh — otherwise somebody would be quietly offered a
	 * second change while the first was still open, and the second would silently replace it.
	 */
	private async loadState(): Promise<void> {
		this.refusal.set(null);
		this.notice.set(null);
		try {
			const [methods, pending] = await Promise.all([
				firstValueFrom(this.authGateway.loginMethods()),
				firstValueFrom(this.contactChange.pending()),
			]);
			this.stepUpMethod.set(methods.stepUpMethod);
			this.pendingChange.set(pending);
			this.changingField.set(pending?.field ?? null);
			if (pending) this.resend.start(pending.resendAvailableAt);
		} catch {
			// The interceptor has already raised the toast. The dialog still opens on the name
			// field, which needs none of this.
		}
	}

	/** Opens the proof step for one credential. Nothing is sent yet. */
	beginChange(field: ContactField): void {
		this.refusal.set(null);
		this.notice.set(null);
		this.changingField.set(field);
	}

	/** Abandons the attempt, and tells the server to drop the pending record too. */
	async cancelChange(): Promise<void> {
		if (this.pendingChange()) {
			await firstValueFrom(this.contactChange.cancel()).catch(() => undefined);
		}
		this.pendingChange.set(null);
		this.changingField.set(null);
		this.resend.reset();
		this.form.patchValue({ currentPassword: '', stepUpCode: '', confirmationCode: '' });
	}

	/** Sends a step-up code, for an account with no password to prove itself with. */
	async sendStepUpCode(channel: 'email' | 'sms'): Promise<void> {
		await this.guard(async () => {
			await firstValueFrom(this.authGateway.requestStepUp(channel));
			this.notice.set('step_up_code_sent');
		});
	}

	/**
	 * Asks the server to start the change: proves the caller, sends a code to the NEW value.
	 *
	 * The account is untouched when this returns. What comes back describes a request in flight,
	 * not a change that happened, and the form keeps showing the current values accordingly.
	 */
	async startChange(): Promise<void> {
		const field = this.changingField();
		if (!field) return;

		const proof = this.stepUpByCode()
			? { otpCode: String(this.form.value.stepUpCode ?? '') }
			: { password: String(this.form.value.currentPassword ?? '') };

		await this.guard(async () => {
			const value = String(this.form.value[field] ?? '').trim();
			const pending = await firstValueFrom(
				field === 'email'
					? this.contactChange.startEmailChange(value, proof)
					: this.contactChange.startPhoneChange(value, proof),
			);
			this.pendingChange.set(pending);
			this.resend.start(pending.resendAvailableAt);
			this.notice.set('contact_change_code_sent');
			this.form.patchValue({ currentPassword: '', stepUpCode: '' });
		});
	}

	async resendCode(): Promise<void> {
		await this.guard(async () => {
			const pending = await firstValueFrom(this.contactChange.resend());
			this.pendingChange.set(pending);
			this.resend.start(pending.resendAvailableAt);
			this.notice.set('contact_change_code_sent');
		});
	}

	/** Spends the code. Only now does the account's value actually move. */
	async confirmChange(): Promise<void> {
		await this.guard(async () => {
			const user = await firstValueFrom(
				this.contactChange.confirm(String(this.form.value.confirmationCode ?? '')),
			);
			this.accountStore.adoptUser(user);
			this.pendingChange.set(null);
			this.changingField.set(null);
			this.resend.reset();
			this.form.patchValue({
				email: user.email,
				phone: user.phone,
				confirmationCode: '',
			});
			this.notice.set('contact_change_done');
		});
	}

	/**
	 * Saves the display name.
	 *
	 * Only the name is sent, and that has not changed: email and phone travel through the
	 * contact-change flow above, and the API refuses them on this route regardless.
	 */
	async submit() {
		this.form.controls['name'].markAsTouched();
		if (this.form.controls['name'].invalid) return;

		const saved = await this.accountStore.updateProfile(String(this.form.value.name ?? ''));
		// Left open on failure so the edit is not lost; the interceptor has already said why.
		if (saved) this.modalService.dismissAll();
	}

	/**
	 * Runs one request, and turns a stable refusal into a line the person can read.
	 *
	 * The code IS the translation key, as on the account-security screen — `refusalCode` falls
	 * back to a generic one when the server sent nothing recognisable, so an unmapped code never
	 * reaches the page raw.
	 */
	private async guard(work: () => Promise<void>): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		this.refusal.set(null);
		this.notice.set(null);
		try {
			await work();
		} catch (error) {
			this.refusal.set(refusalCode(error));
		} finally {
			this.busy.set(false);
		}
	}

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

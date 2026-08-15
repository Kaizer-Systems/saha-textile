import { Component, TemplateRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { TranslocoModule } from '@jsverse/transloco';

// Relative `@core` imports: Storybook path maps prefer storefront `@core/*` first, and
// this modal must bind the admin AuthStore (with `pinConfigured`) for PIN resume.
import { IdleLockService } from '../../../core/auth/idle-lock.service';
import { AuthStore } from '../../../core/state/auth.store';
import { Button } from '../button/button';
import { FormFields } from '../form-fields/form-fields';
import { PinPad } from '../pin-pad/pin-pad';

/**
 * Idle soft-lock overlay — theme-modal + pin-pad / FormFields / Button (DEC-UI-REUSE).
 * Backdrop obscure class lives in theme `_modal.scss` (body-level `.modal-backdrop`).
 */
@Component({
	selector: 'app-idle-lock-modal',
	templateUrl: './idle-lock-modal.html',
	styleUrls: ['./idle-lock-modal.scss'],
	imports: [ReactiveFormsModule, TranslocoModule, Button, FormFields, PinPad],
})
export class IdleLockModal {
	private readonly idle = inject(IdleLockService);
	private readonly auth = inject(AuthStore);
	private readonly router = inject(Router);
	private readonly modalService = inject(NgbModal);

	readonly IdleLockModalTpl = viewChild<TemplateRef<unknown>>('idleLockModal');

	readonly pin = signal('');
	readonly pinLength = 6;
	readonly error = signal<string | null>(null);
	readonly busy = signal(false);

	readonly passwordForm = new FormGroup({
		password: new FormControl('', [Validators.required]),
	});

	private ref: NgbModalRef | null = null;

	constructor() {
		effect(() => {
			const locked = this.idle.locked();
			const authed = this.auth.isAuthenticated();
			if (locked && authed) void this.open();
			else this.dismiss();
		});
	}

	usePin(): boolean {
		return this.auth.user()?.pinConfigured === true;
	}

	private async open(): Promise<void> {
		if (this.ref) return;
		const tpl = this.IdleLockModalTpl();
		if (!tpl) return;
		this.error.set(null);
		this.pin.set('');
		this.passwordForm.reset();
		this.ref = this.modalService.open(tpl, {
			ariaLabelledBy: 'idle-lock-title',
			centered: true,
			backdrop: 'static',
			keyboard: false,
			// Dim layer under the modal (see `.idle-lock-backdrop` in theme modal scss).
			backdropClass: 'idle-lock-backdrop',
			windowClass: 'theme-modal text-center',
		});
	}

	private dismiss(): void {
		if (!this.ref) return;
		this.ref.close();
		this.ref = null;
	}

	async submitPin(): Promise<void> {
		if (this.pin().length !== this.pinLength || this.busy()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const ok = await this.auth.resumeWithPin(this.pin());
			if (ok) {
				this.idle.unlock();
				return;
			}
			if (!this.auth.isAuthenticated()) {
				this.idle.unlock();
				void this.router.navigate(['/auth/login']);
				return;
			}
			this.error.set(this.auth.error() ?? 'invalid_credentials');
			this.pin.set('');
		} finally {
			this.busy.set(false);
		}
	}

	async submitPassword(): Promise<void> {
		this.passwordForm.markAllAsTouched();
		if (!this.passwordForm.valid || this.busy()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const password = this.passwordForm.controls['password'].value as string;
			const ok = await this.auth.resumeWithPassword(password);
			if (ok) {
				this.idle.unlock();
				return;
			}
			if (!this.auth.isAuthenticated()) {
				this.idle.unlock();
				void this.router.navigate(['/auth/login']);
				return;
			}
			this.error.set(this.auth.error() ?? 'invalid_credentials');
		} finally {
			this.busy.set(false);
		}
	}
}

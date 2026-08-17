import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, inject, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import * as data from '@shared/data/country-code';

import { Button } from '../../button/button';

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

	user$: Observable<IAccountUser> = toObservable(this.accountStore.user) as Observable<IAccountUser>;

	public form: FormGroup;
	public closeResult: string;

	public modalOpen: boolean = false;
	public flicker: boolean = false;
	public codes = data.countryCodes;
	public isBrowser: boolean;

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
			});
			this.form?.controls?.['email'].disable();
			setTimeout(() => (this.flicker = false), 200);
		});
	}

	async openModal() {
		if (isPlatformBrowser(this.platformId)) {
			this.modalOpen = true;
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

	/**
	 * Saves the display name.
	 *
	 * Only the name is sent. Email and phone are login credentials, and changing one needs recent
	 * credential proof plus a verification round trip that keeps the old value live until the new
	 * one is proven — so their fields are shown read-only rather than silently ignored, and the
	 * API refuses them on this route regardless.
	 */
	async submit() {
		this.form.controls['name'].markAsTouched();
		if (this.form.controls['name'].invalid) return;

		const saved = await this.accountStore.updateProfile(String(this.form.value.name ?? ''));
		// Left open on failure so the edit is not lost; the interceptor has already said why.
		if (saved) this.modalService.dismissAll();
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

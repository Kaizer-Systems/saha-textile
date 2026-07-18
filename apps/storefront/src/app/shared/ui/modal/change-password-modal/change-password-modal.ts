import { isPlatformBrowser } from '@angular/common';
import { Component, TemplateRef, PLATFORM_ID, inject, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { AccountStore } from '@core/state/account.store';
import { CustomValidators } from '@shared/validators/password-match';

import { Button } from '../../button/button';

@Component({
	selector: 'app-change-password-modal',
	templateUrl: './change-password-modal.html',
	styleUrls: ['./change-password-modal.scss'],
	imports: [Button, ReactiveFormsModule, TranslocoModule],
})
export class ChangePasswordModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);
	private accountStore = inject(AccountStore);
	private formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public closeResult: string;

	public modalOpen: boolean = false;

	readonly PasswordModal = viewChild<TemplateRef<string>>('passwordModal');

	constructor() {
		this.form = this.formBuilder.group(
			{
				current_password: new FormControl('', [Validators.required]),
				password: new FormControl('', [Validators.required]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	async openModal() {
		if (isPlatformBrowser(this.platformId)) {
			this.modalOpen = true;
			this.modalService
				.open(this.PasswordModal(), {
					ariaLabelledBy: 'password-Modal',
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

	get passwordMatchError() {
		return this.form?.getError('mismatch') && this.form?.get('password_confirmation')?.touched;
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			this.accountStore.updatePassword(this.form.value);
			this.form.reset();
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

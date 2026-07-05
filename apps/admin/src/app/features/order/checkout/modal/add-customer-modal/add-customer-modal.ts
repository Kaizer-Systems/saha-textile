import { Component, TemplateRef, inject, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Select2Module } from 'ng-select2-component';

import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import * as data from '@shared/data/country-code';
import { CustomValidators } from '@shared/validators/password-match';

@Component({
	selector: 'app-customer-modal',
	templateUrl: './add-customer-modal.html',
	styleUrls: ['./add-customer-modal.scss'],
	imports: [Button, ReactiveFormsModule, FormFields, Select2Module, TranslateModule],
})
export class AddCustomerModal {
	private modalService = inject(NgbModal);
	private formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public closeResult: string;
	public modalOpen: boolean = false;
	public codes = data.countryCodes;

	readonly AddCustomerModal = viewChild<TemplateRef<string>>('addCustomerModal');

	constructor() {
		this.form = this.formBuilder.group(
			{
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				country_code: new FormControl('91', [Validators.required]),
				phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				password: new FormControl('', [Validators.required]),
				password_confirmation: new FormControl('', [Validators.required]),
				status: new FormControl(1, [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
	}

	async openModal() {
		this.modalOpen = true;
		this.modalService
			.open(this.AddCustomerModal(), {
				ariaLabelledBy: 'add-customer-Modal',
				centered: true,
				windowClass: 'theme-modal modal-lg',
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

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			// Create customer has no backend yet — close the modal.
			this.modalService.dismissAll();
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

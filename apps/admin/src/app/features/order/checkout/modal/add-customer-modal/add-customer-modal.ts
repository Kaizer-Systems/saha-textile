import { Component, TemplateRef, inject, output, viewChild } from '@angular/core';
import {
	AbstractControl,
	FormBuilder,
	FormControl,
	FormGroup,
	ReactiveFormsModule,
	ValidationErrors,
	Validators,
} from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2Module } from 'ng-select2-component';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminCustomersGateway, type NotificationChannel } from '@core/admin-customers/admin-customers.gateway';
import * as data from '@shared/data/country-code';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

function atLeastOneChannel(group: AbstractControl): ValidationErrors | null {
	const email = group.get('channelEmail')?.value;
	const sms = group.get('channelSms')?.value;
	const whatsapp = group.get('channelWhatsapp')?.value;
	return email || sms || whatsapp ? null : { channelsRequired: true };
}

function channelsMatchContact(group: AbstractControl): ValidationErrors | null {
	const email = String(group.get('email')?.value ?? '').trim();
	const phone = String(group.get('phone')?.value ?? '').trim();
	const channelEmail = !!group.get('channelEmail')?.value;
	const channelSms = !!group.get('channelSms')?.value;
	const channelWhatsapp = !!group.get('channelWhatsapp')?.value;

	if (channelEmail && !email) return { emailRequiredForChannel: true };
	if ((channelSms || channelWhatsapp) && !phone) return { phoneRequiredForChannel: true };
	return null;
}

@Component({
	selector: 'app-customer-modal',
	templateUrl: './add-customer-modal.html',
	styleUrls: ['./add-customer-modal.scss'],
	imports: [Button, ReactiveFormsModule, FormFields, Select2Module, TranslocoModule],
})
export class AddCustomerModal {
	private modalService = inject(NgbModal);
	private formBuilder = inject(FormBuilder);
	private readonly gateway = inject(AdminCustomersGateway);
	private readonly queryClient = injectQueryClient();

	readonly created = output<void>();

	public form: FormGroup;
	public closeResult: string;
	public modalOpen: boolean = false;
	public codes = data.countryCodes;

	readonly AddCustomerModal = viewChild<TemplateRef<string>>('addCustomerModal');

	private readonly createMutation = injectMutation(() => ({
		mutationFn: (vars: {
			displayName: string;
			email: string;
			phone: string;
			status: 'pending' | 'active';
			activationChannels: NotificationChannel[];
		}) => lastValueFrom(this.gateway.create(vars)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
			this.created.emit();
			this.modalService.dismissAll();
			this.form.reset({
				name: '',
				email: '',
				country_code: '91',
				phone: '',
				status: 'pending',
				channelEmail: true,
				channelSms: false,
				channelWhatsapp: false,
			});
		},
	}));

	constructor() {
		this.form = this.formBuilder.group(
			{
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				country_code: new FormControl('91', [Validators.required]),
				phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				status: new FormControl('pending', [Validators.required]),
				channelEmail: new FormControl(true),
				channelSms: new FormControl(false),
				channelWhatsapp: new FormControl(false),
			},
			{ validators: [atLeastOneChannel, channelsMatchContact] },
		);
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

	private composePhone(countryCode: string, phone: string): string | undefined {
		const digits = phone.trim();
		if (!digits) return undefined;
		let dial = `+${countryCode}`;
		for (const item of this.codes) {
			if (!('value' in item) || String(item.value) !== String(countryCode)) continue;
			const nested = item.data as { code?: string } | undefined;
			if (nested?.code) dial = nested.code.replace(/\s/g, '');
			break;
		}
		return `${dial}${digits}`;
	}

	private selectedChannels(): NotificationChannel[] {
		const channels: NotificationChannel[] = [];
		if (this.form.get('channelEmail')?.value) channels.push('email');
		if (this.form.get('channelSms')?.value) channels.push('sms');
		if (this.form.get('channelWhatsapp')?.value) channels.push('whatsapp');
		return channels;
	}

	submit() {
		this.form.markAllAsTouched();
		if (!this.form.valid) return;

		const phone = this.composePhone(
			String(this.form.get('country_code')?.value ?? '91'),
			String(this.form.get('phone')?.value ?? ''),
		);
		if (!phone) return;

		this.createMutation.mutate({
			displayName: String(this.form.get('name')?.value ?? '').trim(),
			email: String(this.form.get('email')?.value ?? '').trim(),
			phone,
			status: (this.form.get('status')?.value as 'pending' | 'active') || 'pending',
			activationChannels: this.selectedChannels(),
		});
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

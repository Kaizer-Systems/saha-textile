import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject, input, signal, TemplateRef, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
	AbstractControl,
	FormArray,
	FormBuilder,
	FormControl,
	FormGroup,
	ReactiveFormsModule,
	ValidationErrors,
	Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { Observable, lastValueFrom } from 'rxjs';

import {
	AdminCustomersGateway,
	type CustomerAddress,
	type NotificationChannel,
} from '@core/admin-customers/admin-customers.gateway';
import { ITableClickedAction } from '@data-access/interfaces/table.interface';
import { injectAdminCustomerQuery } from '@data-access/queries/admin-customers.queries';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import { NotificationService } from '@data-access/services/notification.service';
import * as data from '@shared/data/country-code';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';

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
	selector: 'app-form-customer',
	templateUrl: './form-customer.html',
	styleUrls: ['./form-customer.scss'],
	imports: [ReactiveFormsModule, FormFields, Select2Module, Button, TranslocoModule, DeleteModal, AsyncPipe],
})
export class FormCustomer {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly formBuilder = inject(FormBuilder);
	private readonly gateway = inject(AdminCustomersGateway);
	private readonly queryClient = injectQueryClient();
	private readonly modalService = inject(NgbModal);
	private readonly notificationService = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly countriesQuery = injectCountriesQuery();
	private readonly statesQuery = injectStatesQuery();

	readonly type = input<string>(undefined);

	private readonly customerId = signal<string | null>(null);
	private readonly customerQuery = injectAdminCustomerQuery(() => this.customerId());
	/** Country id for the Add Address modal state filter. */
	private readonly modalCountryId = signal<number | null>(null);

	readonly statusOptions = [
		{ label: 'Pending', value: 'pending' },
		{ label: 'Active', value: 'active' },
		{ label: 'Disabled', value: 'disabled' },
		{ label: 'Locked', value: 'locked' },
	];

	readonly codes = data.countryCodes;
	readonly isBrowser: boolean;

	public form: FormGroup;
	public activationForm: FormGroup;
	public addressForm: FormGroup;
	public readonly addressForms: FormArray<FormGroup>;

	readonly AddAddressModal = viewChild<TemplateRef<string>>('addAddressModal');
	readonly DeleteModal = viewChild<DeleteModal>('deleteModal');

	private readonly draftAddresses = signal<CustomerAddress[]>([]);
	private syncSignature = '';

	readonly customer = computed(() => this.customerQuery.data() ?? null);
	readonly addresses = computed<CustomerAddress[]>(() => {
		if (this.type() === 'create') return this.draftAddresses();
		return this.customer()?.addresses ?? [];
	});
	readonly canResendActivation = computed(() => {
		const status = this.customer()?.status;
		return status === 'pending' || status === 'disabled' || status === 'locked';
	});

	countries$: Observable<Select2Data> = toObservable(
		computed(
			() => this.countriesQuery.data()?.map((country) => ({ label: country.name, value: country.id })) ?? [],
		),
	);
	modalStates$: Observable<Select2Data> = toObservable(computed(() => this.filterStates(this.modalCountryId())));

	private readonly createMutation = injectMutation(() => ({
		mutationFn: async (vars: {
			displayName: string;
			email: string;
			phone: string;
			status: 'pending' | 'active' | 'disabled' | 'locked';
			activationChannels: NotificationChannel[];
			draftAddresses: Array<{
				label?: string;
				fullName: string;
				line1: string;
				line2?: string;
				city: string;
				state: string;
				postalCode: string;
				country: string;
				phone: string;
				isDefault: boolean;
			}>;
		}) => {
			const customer = await lastValueFrom(
				this.gateway.create({
					displayName: vars.displayName,
					email: vars.email,
					phone: vars.phone,
					status: vars.status,
					activationChannels: vars.activationChannels,
				}),
			);
			for (const address of vars.draftAddresses) {
				await lastValueFrom(this.gateway.addAddress(customer.id, address));
			}
			return customer;
		},
		onSuccess: (customer) => {
			this.draftAddresses.set([]);
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
			void this.router.navigateByUrl(`/customer/edit/${customer.id}`);
		},
	}));

	private readonly updateMutation = injectMutation(() => ({
		mutationFn: (vars: {
			customerId: string;
			displayName: string;
			email: string;
			phone: string;
			status: 'pending' | 'active' | 'disabled' | 'locked';
		}) =>
			lastValueFrom(
				this.gateway.update(vars.customerId, {
					displayName: vars.displayName,
					email: vars.email,
					phone: vars.phone,
					status: vars.status,
				}),
			),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customer', this.customerId()] });
		},
	}));

	private readonly resendMutation = injectMutation(() => ({
		mutationFn: (vars: { customerId: string; activationChannels: NotificationChannel[] }) =>
			lastValueFrom(
				this.gateway.resendActivation(vars.customerId, { activationChannels: vars.activationChannels }),
			),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customer', this.customerId()] });
		},
	}));

	private readonly addAddressMutation = injectMutation(() => ({
		mutationFn: (vars: {
			customerId: string;
			label?: string;
			fullName: string;
			line1: string;
			line2?: string;
			city: string;
			state: string;
			postalCode: string;
			country: string;
			phone: string;
			isDefault: boolean;
		}) => {
			const { customerId, ...input } = vars;
			return lastValueFrom(this.gateway.addAddress(customerId, input));
		},
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customer', this.customerId()] });
			this.resetAddressForm();
			this.modalService.dismissAll();
		},
	}));

	private readonly updateAddressMutation = injectMutation(() => ({
		mutationFn: (vars: {
			customerId: string;
			addressId: string;
			label?: string;
			fullName: string;
			line1: string;
			line2?: string;
			city: string;
			state: string;
			postalCode: string;
			country: string;
			phone: string;
			isDefault: boolean;
		}) => {
			const { customerId, addressId, ...input } = vars;
			return lastValueFrom(this.gateway.updateAddress(customerId, addressId, input));
		},
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customer', this.customerId()] });
		},
	}));

	private readonly deleteAddressMutation = injectMutation(() => ({
		mutationFn: (vars: { customerId: string; addressId: string }) =>
			lastValueFrom(this.gateway.deleteAddress(vars.customerId, vars.addressId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-customer', this.customerId()] });
			this.notificationService.showSuccess(this.transloco.translate('address_deleted_successfully'));
		},
	}));

	constructor() {
		const platformId = inject(PLATFORM_ID);
		this.isBrowser = isPlatformBrowser(platformId);
		this.addressForms = this.formBuilder.array<FormGroup>([]);

		this.form = this.formBuilder.group(
			{
				displayName: new FormControl('', [Validators.required]),
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

		this.activationForm = this.formBuilder.group(
			{
				channelEmail: new FormControl(true),
				channelSms: new FormControl(false),
				channelWhatsapp: new FormControl(false),
			},
			{ validators: [atLeastOneChannel] },
		);

		this.addressForm = this.buildAddressGroup();

		effect(
			() => {
				const id = this.route.snapshot.paramMap.get('id');
				if (id) this.customerId.set(id);
			},
			{ allowSignalWrites: true },
		);

		effect(() => {
			if (this.type() !== 'edit') return;
			const customer = this.customer();
			if (!customer) return;

			const parsed = this.splitPhone(customer.phone ?? '');
			this.form.patchValue({
				displayName: customer.displayName ?? '',
				email: customer.email ?? '',
				country_code: parsed.countryCode,
				phone: parsed.localPhone,
				status: customer.status === 'deleted' ? 'disabled' : customer.status,
			});
			this.form.get('channelEmail')?.clearValidators();
			this.form.get('channelSms')?.clearValidators();
			this.form.get('channelWhatsapp')?.clearValidators();
			this.form.setValidators(null);
			this.form.updateValueAndValidity({ emitEvent: false });
		});

		effect(() => {
			const rows = this.addresses();
			// Wait for country catalogue so ISO → id hydration works.
			if (!this.countriesQuery.data()?.length && rows.some((row) => row.country)) return;
			const signature = rows
				.map(
					(row) =>
						`${row.id}|${row.isDefault}|${row.label ?? ''}|${row.fullName}|${row.line1}|${row.line2 ?? ''}|${row.city}|${row.state ?? ''}|${row.postalCode}|${row.country}|${row.phone ?? ''}`,
				)
				.join(';;');
			if (signature === this.syncSignature) return;
			this.syncSignature = signature;
			this.rebuildAddressForms(rows);
		});
	}

	addressGroupAt(index: number): FormGroup {
		return this.addressForms.at(index);
	}

	statesForGroup(group: FormGroup): Select2Data {
		const countryId = group.get('country_id')?.value;
		return this.filterStates(countryId ? Number(countryId) : null);
	}

	private filterStates(countryId?: number | null): Select2Data {
		const states = this.statesQuery.data() ?? [];
		const filtered = countryId ? states.filter((element) => Number(element.country_id) === countryId) : states;
		return filtered.map((st) => ({ label: st.name, value: st.id, country_id: st.country_id })) as Select2Data;
	}

	private resolveCountryId(isoOrName: string | undefined): number | null {
		if (!isoOrName) return null;
		const countries = this.countriesQuery.data() ?? [];
		const needle = isoOrName.trim().toUpperCase();
		const byIso = countries.find((c) => c.iso_3166_2?.toUpperCase() === needle);
		if (byIso) return byIso.id;
		const byName = countries.find((c) => c.name.toLowerCase() === isoOrName.trim().toLowerCase());
		return byName?.id ?? null;
	}

	private resolveStateId(countryId: number | null, stateName: string | undefined): number | null {
		if (!countryId || !stateName) return null;
		const states = this.statesQuery.data() ?? [];
		const match = states.find(
			(st) => Number(st.country_id) === countryId && st.name.toLowerCase() === stateName.trim().toLowerCase(),
		);
		return match?.id ?? null;
	}

	private isoForCountryId(countryId: unknown): string {
		const id = Number(countryId);
		const country = (this.countriesQuery.data() ?? []).find((c) => c.id === id);
		return country?.iso_3166_2?.trim() || 'IN';
	}

	private nameForStateId(stateId: unknown): string | undefined {
		if (stateId === '' || stateId === null || stateId === undefined) return undefined;
		const id = Number(stateId);
		const state = (this.statesQuery.data() ?? []).find((st) => st.id === id);
		return state?.name;
	}

	private buildAddressGroup(seed?: CustomerAddress): FormGroup {
		const parsed = this.splitPhone(seed?.phone ?? '');
		const countryId = this.resolveCountryId(seed?.country) ?? this.resolveCountryId('IN');
		const stateId = this.resolveStateId(countryId, seed?.state);
		return this.formBuilder.group({
			id: new FormControl(seed?.id ?? ''),
			label: new FormControl(seed?.label ?? ''),
			fullName: new FormControl(seed?.fullName ?? '', [Validators.required]),
			line1: new FormControl(seed?.line1 ?? '', [Validators.required]),
			line2: new FormControl(seed?.line2 ?? ''),
			city: new FormControl(seed?.city ?? '', [Validators.required]),
			country_id: new FormControl(countryId ?? '', [Validators.required]),
			state_id: new FormControl(stateId ?? '', [Validators.required]),
			postalCode: new FormControl(seed?.postalCode ?? '', [Validators.required]),
			country_code: new FormControl(parsed.countryCode, [Validators.required]),
			phone: new FormControl(parsed.localPhone, [Validators.required, Validators.pattern(/^[0-9]*$/)]),
			isDefault: new FormControl(seed?.isDefault ?? false),
		});
	}

	private rebuildAddressForms(rows: CustomerAddress[]) {
		this.addressForms.clear();
		for (const row of rows) {
			this.addressForms.push(this.buildAddressGroup(row));
		}
	}

	private splitPhone(phone: string): { countryCode: string; localPhone: string } {
		let countryCode = '91';
		let localPhone = phone.replace(/\D/g, '');
		if (phone.startsWith('+')) {
			for (const item of this.codes) {
				if (!('value' in item)) continue;
				const dial = (item.data as { code?: string } | undefined)?.code?.replace(/\s/g, '');
				if (!dial || !phone.startsWith(dial)) continue;
				countryCode = String(item.value);
				localPhone = phone.slice(dial.length).replace(/\D/g, '');
				break;
			}
		}
		return { countryCode, localPhone };
	}

	private selectedChannels(source: FormGroup): NotificationChannel[] {
		const channels: NotificationChannel[] = [];
		if (source.get('channelEmail')?.value) channels.push('email');
		if (source.get('channelSms')?.value) channels.push('sms');
		if (source.get('channelWhatsapp')?.value) channels.push('whatsapp');
		return channels;
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

	private payloadFromAddressGroup(group: FormGroup) {
		const phone = this.composePhone(
			String(group.get('country_code')?.value ?? '91'),
			String(group.get('phone')?.value ?? ''),
		);
		const label = String(group.get('label')?.value ?? '').trim();
		const line2 = String(group.get('line2')?.value ?? '').trim();
		const stateName = this.nameForStateId(group.get('state_id')?.value);
		return {
			label: label || undefined,
			fullName: String(group.get('fullName')?.value ?? '').trim(),
			line1: String(group.get('line1')?.value ?? '').trim(),
			line2: line2 || undefined,
			city: String(group.get('city')?.value ?? '').trim(),
			state: stateName ?? '',
			postalCode: String(group.get('postalCode')?.value ?? '').trim(),
			country: this.isoForCountryId(group.get('country_id')?.value),
			phone: phone ?? '',
			isDefault: !!group.get('isDefault')?.value,
		};
	}

	submit() {
		this.form.markAllAsTouched();
		if (!this.form.valid) return;

		const displayName = String(this.form.get('displayName')?.value ?? '').trim();
		const email = String(this.form.get('email')?.value ?? '').trim();
		const phone = this.composePhone(
			String(this.form.get('country_code')?.value ?? '91'),
			String(this.form.get('phone')?.value ?? ''),
		);
		if (!phone) return;
		const status = this.form.get('status')?.value as 'pending' | 'active' | 'disabled' | 'locked';

		if (this.type() === 'create') {
			this.createMutation.mutate({
				displayName,
				email,
				phone,
				status,
				activationChannels: this.selectedChannels(this.form),
				draftAddresses: this.draftAddresses().map((address) => ({
					label: address.label,
					fullName: address.fullName,
					line1: address.line1,
					line2: address.line2,
					city: address.city,
					state: address.state,
					postalCode: address.postalCode,
					country: address.country,
					phone: address.phone,
					isDefault: address.isDefault,
				})),
			});
			return;
		}

		const id = this.customerId();
		if (!id) return;
		this.updateMutation.mutate({
			customerId: id,
			displayName,
			email,
			phone,
			status,
		});
	}

	resendActivation() {
		this.activationForm.markAllAsTouched();
		if (!this.activationForm.valid) return;
		const id = this.customerId();
		if (!id) return;

		const channels = this.selectedChannels(this.activationForm);
		const email = String(this.form.get('email')?.value ?? '').trim();
		const phone = String(this.form.get('phone')?.value ?? '').trim();
		if (channels.includes('email') && !email) {
			this.activationForm.setErrors({ emailRequiredForChannel: true });
			return;
		}
		if ((channels.includes('sms') || channels.includes('whatsapp')) && !phone) {
			this.activationForm.setErrors({ phoneRequiredForChannel: true });
			return;
		}

		this.resendMutation.mutate({ customerId: id, activationChannels: channels });
	}

	openAddressModal() {
		const tpl = this.AddAddressModal();
		if (!tpl) return;
		this.modalCountryId.set(
			this.addressForm.get('country_id')?.value ? Number(this.addressForm.get('country_id')?.value) : null,
		);
		this.modalService.open(tpl, {
			ariaLabelledBy: 'address-add-Modal',
			centered: true,
			windowClass: 'theme-modal modal-lg',
		});
	}

	modalCountryChange(event: Select2UpdateEvent) {
		if (event?.value) {
			this.modalCountryId.set(Number(event.value));
			this.addressForm.controls['state_id'].setValue('');
		}
	}

	addressCountryChange(index: number, event: Select2UpdateEvent) {
		const group = this.addressGroupAt(index);
		if (event?.value) {
			group.patchValue({ country_id: event.value, state_id: '' });
		}
	}

	private resetAddressForm() {
		const indiaId = this.resolveCountryId('IN');
		this.modalCountryId.set(indiaId);
		this.addressForm.reset({
			id: '',
			label: '',
			fullName: '',
			line1: '',
			line2: '',
			city: '',
			country_id: indiaId ?? '',
			state_id: '',
			postalCode: '',
			country_code: '91',
			phone: '',
			isDefault: false,
		});
	}

	submitAddress() {
		this.addressForm.markAllAsTouched();
		if (!this.addressForm.valid) return;

		const payload = this.payloadFromAddressGroup(this.addressForm);

		if (this.type() === 'create') {
			const draftId = `draft_${crypto.randomUUID()}`;
			this.draftAddresses.update((rows) => {
				const next = [...rows];
				if (payload.isDefault) {
					for (let i = 0; i < next.length; i++) {
						next[i] = { ...next[i]!, isDefault: false };
					}
				}
				next.push({
					id: draftId,
					...payload,
					isDefault: payload.isDefault || next.length === 0,
				});
				return next;
			});
			this.resetAddressForm();
			this.modalService.dismissAll();
			return;
		}

		const id = this.customerId();
		if (!id) return;

		this.addAddressMutation.mutate({
			customerId: id,
			...payload,
		});
	}

	saveAddressAt(index: number) {
		const group = this.addressGroupAt(index);
		group.markAllAsTouched();
		if (!group.valid) return;

		const payload = this.payloadFromAddressGroup(group);
		const addressId = String(group.get('id')?.value ?? '');

		if (this.type() === 'create') {
			this.draftAddresses.update((rows) =>
				rows.map((row) => {
					if (row.id !== addressId) {
						return payload.isDefault ? { ...row, isDefault: false } : row;
					}
					return { ...row, ...payload, id: addressId };
				}),
			);
			return;
		}

		const customerId = this.customerId();
		if (!customerId || !addressId) return;
		this.updateAddressMutation.mutate({
			customerId,
			addressId,
			...payload,
		});
	}

	onDefaultToggle(index: number, event: Event) {
		const checked = (event.target as HTMLInputElement).checked;
		for (let i = 0; i < this.addressForms.length; i++) {
			this.addressForms
				.at(i)
				.get('isDefault')
				?.setValue(checked && i === index, { emitEvent: false });
		}
		// Persist the toggled row (and exclusive clearing of siblings via isDefault flags).
		this.saveAddressAt(index);
	}

	confirmDeleteAddress(index: number) {
		const group = this.addressGroupAt(index);
		const addressId = String(group.get('id')?.value ?? '');
		if (!addressId) return;
		void this.DeleteModal()?.openModal('delete', { id: addressId, index });
	}

	onDeleteConfirmed(action: ITableClickedAction) {
		if (action.actionToPerform !== 'delete') return;
		const data = action.data as { id?: string; index?: number } | undefined;
		const addressId = String(data?.id ?? '');
		if (!addressId) return;

		if (this.type() === 'create') {
			this.draftAddresses.update((rows) => rows.filter((row) => row.id !== addressId));
			this.notificationService.showSuccess(this.transloco.translate('address_deleted_successfully'));
			return;
		}

		const customerId = this.customerId();
		if (!customerId) return;
		this.deleteAddressMutation.mutate({ customerId, addressId });
	}
}

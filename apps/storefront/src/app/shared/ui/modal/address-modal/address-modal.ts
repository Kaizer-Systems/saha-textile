import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, TemplateRef, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { ICustomerAddress } from '@data-access/interfaces/customer.interface';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import * as data from '@shared/data/country-code';
import { resolveAddressLocation, type CountryRecord, type StateRecord } from '@shared/util/address-location';

import { Button } from '../../button/button';

@Component({
	selector: 'address-modal',
	templateUrl: './address-modal.html',
	styleUrls: ['./address-modal.scss'],
	imports: [Button, ReactiveFormsModule, Select2Module, AsyncPipe, TranslocoModule],
})
export class AddressModal {
	private modalService = inject(NgbModal);
	private platformId = inject<Object>(PLATFORM_ID);
	private accountStore = inject(AccountStore);
	private formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public closeResult: string;
	public modalOpen: boolean = false;

	private readonly statesQuery = injectStatesQuery();
	private readonly selectedCountryId = signal<number | null>(null);
	states$: Observable<Select2Data> = toObservable(computed(() => this.filterStates(this.selectedCountryId())));
	public address: IUserAddress | null;
	public codes = data.countryCodes;
	public isBrowser: boolean;

	readonly AddressModal = viewChild<TemplateRef<string>>('addressModal');

	private readonly countriesQuery = injectCountriesQuery();
	countries$: Observable<Select2Data> = toObservable(
		computed(() => this.countriesQuery.data()?.map((cn) => ({ label: cn.name, value: cn.id })) ?? []),
	);

	constructor() {
		this.isBrowser = isPlatformBrowser(this.platformId);
		this.form = this.formBuilder.group({
			title: new FormControl('', [Validators.required]),
			street: new FormControl('', [Validators.required]),
			state_id: new FormControl('', [Validators.required]),
			country_id: new FormControl('', [Validators.required]),
			city: new FormControl('', [Validators.required]),
			pincode: new FormControl('', [Validators.required]),
			country_code: new FormControl('91', [Validators.required]),
			phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
		});
	}

	/**
	 * Choosing a country re-derives everything that depends on it.
	 *
	 * The dial code follows the country rather than being chosen separately, because an address's
	 * phone belongs to that address's country — and because picking it from a list keyed by dial
	 * code cannot distinguish the several countries that share one.
	 */
	countryChange(data: Select2UpdateEvent) {
		const countryId = data?.value ? Number(data.value) : null;
		this.selectedCountryId.set(countryId);

		// A state from the previous country is meaningless under the new one.
		this.form.controls['state_id'].setValue('');

		const country = (this.countriesQuery.data() ?? []).find((entry) => entry.id === countryId);
		const callingCode = (country as CountryRecord | undefined)?.calling_code;
		if (callingCode) this.form.controls['country_code'].setValue(callingCode);
	}

	// Replicates the old NGXS `states` filter-function selector over query data.
	private filterStates(country_id: number | null): Select2Data {
		const all = this.statesQuery.data() ?? [];
		const list = country_id ? all.filter((st) => st.country_id == country_id) : [];
		return list.map((st) => ({ label: st.name, value: st.id, country_id: st.country_id }));
	}

	async openModal(value?: IUserAddress) {
		if (isPlatformBrowser(this.platformId)) {
			this.modalOpen = true;
			this.patchForm(value);
			this.modalService
				.open(this.AddressModal(), {
					ariaLabelledBy: 'address-add-Modal',
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
	 * Fills the form from a saved address.
	 *
	 * The country, state and dial-code pickers are keyed by ID, but a saved address stores NAMES —
	 * so patching the raw values left all three empty on every edit. They are resolved here, and
	 * strictly in the order country → state → dial code: see `address-location.ts` for why any
	 * other order picks the wrong country when a dial code or a state name is shared.
	 */
	patchForm(value?: IUserAddress) {
		if (value) {
			this.address = value;

			const location = resolveAddressLocation({
				countries: (this.countriesQuery.data() ?? []) as unknown as CountryRecord[],
				states: (this.statesQuery.data() ?? []) as unknown as StateRecord[],
				countryName: value.country?.name,
				stateName: value.state?.name,
			});
			// Drives the state list, which is filtered by the country that was just resolved.
			this.selectedCountryId.set(location.countryId);

			this.form.patchValue({
				user_id: value?.user_id,
				title: value?.title,
				street: value?.street,
				country_id: location.countryId ?? '',
				state_id: location.stateId ?? '',
				city: value?.city,
				pincode: value?.pincode,
				// From the resolved COUNTRY, never from the stored number: `+1` alone cannot say
				// whether this address is in the USA, Canada or American Samoa.
				country_code: location.callingCode ?? String(value?.country_code ?? '91'),
				phone: value?.phone,
			});
		} else {
			this.address = null;
			this.form.reset();
			this.form?.controls?.['country_code'].setValue('91');
		}
	}

	/**
	 * Turns the form back into an address the API understands.
	 *
	 * The pickers hold IDS; our address stores NAMES and one E.164 phone. Resolving the names
	 * here — from the same country and state data the pickers were filled from — keeps the
	 * translation in one place and means the id scheme is never sent to the server.
	 */
	private toDomainAddress(): Omit<ICustomerAddress, 'id'> | null {
		const value = this.form.value;
		const countryId = Number(value.country_id);
		const country = (this.countriesQuery.data() ?? []).find((entry) => entry.id === countryId);
		if (!country) return null;

		const stateId = Number(value.state_id);
		const state = (this.statesQuery.data() ?? []).find((entry) => entry.id === stateId);
		const dialCode = String(value.country_code ?? country.calling_code ?? '').replace(/\D/g, '');

		return {
			label: String(value.title ?? ''),
			fullName: String(value.title ?? ''),
			line1: String(value.street ?? ''),
			/**
			 * Explicitly emptied, not omitted.
			 *
			 * This form has ONE address field, and the list flattens `line1, line2` into it. A
			 * PATCH that simply left `line2` out would keep the stored one, so editing appended
			 * the old second line to the new combined first line and the address grew a duplicate
			 * fragment every save.
			 */
			line2: '',
			city: String(value.city ?? ''),
			state: state?.name ?? '',
			postalCode: String(value.pincode ?? ''),
			country: country.name,
			phone: `+${dialCode}${String(value.phone ?? '')}`,
			isDefault: this.address?.is_default ?? false,
		};
	}

	async submit() {
		this.form.markAllAsTouched();
		if (!this.form.valid) return;

		const address = this.toDomainAddress();
		if (!address) return;

		const saved = this.address?.address_id
			? await this.accountStore.updateAddress(this.address.address_id, address)
			: await this.accountStore.createAddress(address);
		// The dialog stays open on failure so the entry is not lost; the interceptor has already
		// said what went wrong.
		if (!saved) return;

		this.modalService.dismissAll();
		this.form.reset();
		this.form?.controls?.['country_code'].setValue('91');
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

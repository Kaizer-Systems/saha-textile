import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, TemplateRef, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import * as data from '@shared/data/country-code';

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

	countryChange(data: Select2UpdateEvent) {
		if (data && data?.value) {
			this.selectedCountryId.set(+data?.value);
			if (!this.address) this.form.controls['state_id'].setValue('');
		} else {
			this.form.controls['state_id'].setValue('');
		}
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

	patchForm(value?: IUserAddress) {
		if (value) {
			this.address = value;
			this.form.patchValue({
				user_id: value?.user_id,
				title: value?.title,
				street: value?.street,
				country_id: value?.country_id,
				state_id: value?.state_id,
				city: value?.city,
				pincode: value?.pincode,
				country_code: value?.country_code,
				phone: value?.phone,
			});
		} else {
			this.address = null;
			this.form.reset();
			this.form?.controls?.['country_code'].setValue('91');
		}
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			if (this.address) {
				this.accountStore.updateAddress(this.form.value, this.address.id);
			} else {
				this.accountStore.createAddress(this.form.value);
			}
			this.form.reset();
			if (!this.address) {
				this.form?.controls?.['country_code'].setValue('91');
			}
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

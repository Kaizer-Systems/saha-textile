import { TitleCasePipe, AsyncPipe } from '@angular/common';
import { Component, computed, inject, input, signal, TemplateRef, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import * as data from '@shared/data/country-code';
import { NumberDirective } from '@shared/directives/numbers-only.directive';

@Component({
	selector: 'app-address-modal',
	templateUrl: './add-address-modal.html',
	styleUrls: ['./add-address-modal.scss'],
	imports: [
		Button,
		ReactiveFormsModule,
		FormFields,
		Select2Module,
		NumberDirective,
		TitleCasePipe,
		TranslateModule,
		AsyncPipe,
		TitleCasePipe,
	],
})
export class AddAddressModal {
	private modalService = inject(NgbModal);
	private formBuilder = inject(FormBuilder);

	public form: FormGroup;
	public closeResult: string;
	public modalOpen: boolean = false;

	public codes = data.countryCodes;

	private readonly countriesQuery = injectCountriesQuery();
	private readonly statesQuery = injectStatesQuery();
	private readonly selectedCountryId = signal<number | null>(null);

	countries$: Observable<Select2Data> = toObservable(
		computed(() => this.countriesQuery.data()?.map((country) => ({ label: country.name, value: country.id })) ?? []),
	);
	states$: Observable<Select2Data> = toObservable(computed(() => this.filterStates(this.selectedCountryId())));

	readonly AddAddressModal = viewChild<TemplateRef<string>>('addAddressModal');

	readonly id = input<number>(undefined);

	constructor() {
		this.form = this.formBuilder.group({
			user_id: new FormControl(''),
			title: new FormControl('', [Validators.required]),
			street: new FormControl('', [Validators.required]),
			type: new FormControl('shipping', [Validators.required]),
			state_id: new FormControl('', [Validators.required]),
			country_id: new FormControl('', [Validators.required]),
			city: new FormControl('', [Validators.required]),
			pincode: new FormControl('', [Validators.required]),
			country_code: new FormControl('91', [Validators.required]),
			phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
		});
	}

	// Replicates the former StateState.states selector: states optionally filtered by country.
	private filterStates(country_id?: number | null): Select2Data {
		const states = this.statesQuery.data() ?? [];
		const filtered = country_id ? states.filter((element) => element.country_id == country_id) : states;
		return filtered.map((st) => ({ label: st?.name, value: st?.id, country_id: st?.country_id })) as Select2Data;
	}

	countryChange(data: Select2UpdateEvent) {
		if (data && data?.value) {
			this.selectedCountryId.set(+data?.value);
			this.form.controls['state_id'].setValue('');
		}
	}

	async openModal(value?: string) {
		this.form.controls['type'].setValue(value);
		this.modalOpen = true;
		this.modalService
			.open(this.AddAddressModal(), {
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

	private getDismissReason(reason: ModalDismissReasons): string {
		if (reason === ModalDismissReasons.ESC) {
			return 'by pressing ESC';
		} else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
			return 'by clicking on a backdrop';
		} else {
			return `with: ${reason}`;
		}
	}

	submit(id: number) {
		this.form.markAllAsTouched();
		this.form.controls['user_id'].setValue(id);
		if (this.form.valid) {
			// Create address has no backend yet — close the modal.
			this.modalService.dismissAll();
		}
	}

	ngOnDestroy() {
		if (this.modalOpen) {
			this.modalService.dismissAll();
		}
	}
}

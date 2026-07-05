import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, computed, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable, Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import * as data from '@shared/data/country-code';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import { StoreService } from '@data-access/services/store.service';
import { CustomValidators } from '@shared/validators/password-match';

@Component({
	selector: 'app-form-store',
	templateUrl: './form-store.html',
	styleUrls: ['./form-store.scss'],
	imports: [ReactiveFormsModule, FormFields, ImageUpload, Select2Module, Button, TranslateModule, AsyncPipe],
})
export class FormStore {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private storeService = inject(StoreService);

	readonly type = input<string>(undefined);

	private readonly countriesQuery = injectCountriesQuery();
	private readonly statesQuery = injectStatesQuery();
	private readonly selectedCountryId = signal<number | null>(null);

	countries$: Observable<Select2Data> = toObservable(
		computed(() => this.countriesQuery.data()?.map((country) => ({ label: country.name, value: country.id })) ?? []),
	);
	states$: Observable<Select2Data> = toObservable(computed(() => this.filterStates(this.selectedCountryId())));

	private destroy$ = new Subject<void>();

	public form: FormGroup;
	public id: number;
	public codes = data.countryCodes;
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group(
			{
				store_name: new FormControl('', [Validators.required]),
				description: new FormControl('', [Validators.required]),
				country_id: new FormControl('', [Validators.required]),
				state_id: new FormControl('', [Validators.required]),
				city: new FormControl('', [Validators.required]),
				address: new FormControl('', [Validators.required]),
				pincode: new FormControl('', [Validators.required]),
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				phone: new FormControl('', [Validators.required]),
				country_code: new FormControl('91', [Validators.required]),
				password: new FormControl('', [Validators.required]),
				password_confirmation: new FormControl('', [Validators.required]),
				store_logo_id: new FormControl(''),
				hide_vendor_email: new FormControl(0),
				hide_vendor_phone: new FormControl(0),
				status: new FormControl(1),
				facebook: new FormControl(''),
				instagram: new FormControl(''),
				pinterest: new FormControl(''),
				youtube: new FormControl(''),
				twitter: new FormControl(''),
			},
			{
				validator: CustomValidators.MatchValidator('password', 'password_confirmation'),
			},
		);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.storeService
						.getStores()
						.pipe(map((res) => res.data.find((store) => store.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((store) => {
				this.id = store?.id!;
				this.form.patchValue({
					store_name: store?.store_name,
					description: store?.description,
					country_id: store?.country_id,
					state_id: store?.state_id,
					city: store?.city,
					address: store?.address,
					pincode: store?.pincode,
					name: store?.vendor?.name,
					email: store?.vendor?.email,
					country_code: store?.vendor?.country_code,
					phone: store?.vendor?.phone,
					store_logo_id: store?.store_logo_id,
					hide_vendor_email: store?.hide_vendor_email,
					hide_vendor_phone: store?.hide_vendor_phone,
					status: store?.status,
					facebook: store?.facebook,
					instagram: store?.instagram,
					pinterest: store?.pinterest,
					youtube: store?.youtube,
					twitter: store?.twitter,
				});
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
		} else {
			this.form.controls['state_id'].setValue('');
		}
	}

	selectStoreLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['store_logo_id'].setValue(data ? data.id : '');
		}
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.type() == 'edit' && this.id) {
			this.form.removeControl('password');
			this.form.removeControl('password_confirmation');
		}

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate back to the list.
			void this.router.navigateByUrl('/store');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}

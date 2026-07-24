import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, computed, PLATFORM_ID, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import {
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { AccountStore } from '@core/state/account.store';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { injectStatesQuery } from '@data-access/queries/state.queries';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import * as data from '@shared/data/country-code';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { CustomValidators } from '@shared/validators/password-match';

@Component({
	selector: 'app-account',
	templateUrl: './account.html',
	styleUrls: ['./account.scss'],
	imports: [
		PageWrapper,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		ReactiveFormsModule,
		FormFields,
		ImageUpload,
		Select2Module,
		Button,
		NgbNavOutlet,
		TranslocoModule,
		AsyncPipe,
	],
})
export class Account {
	private formBuilder = inject(FormBuilder);
	private accountStore = inject(AccountStore);

	private readonly countriesQuery = injectCountriesQuery();
	private readonly statesQuery = injectStatesQuery();
	private readonly selectedCountryId = signal<number | null>(null);

	user$: Observable<IAccountUser | null> = toObservable(this.accountStore.user);
	countries$: Observable<Select2Data> = toObservable(
		computed(
			() => this.countriesQuery.data()?.map((country) => ({ label: country.name, value: country.id })) ?? [],
		),
	);
	roleName$: Observable<string | null> = toObservable(this.accountStore.roleName);

	public active = 'profile';
	public profileForm: FormGroup;
	public passwordForm: FormGroup;
	public form: FormGroup;
	public codes = data.countryCodes;
	states$: Observable<Select2Data> = toObservable(computed(() => this.filterStates(this.selectedCountryId())));
	public flicker: boolean = false;
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
		this.user$.subscribe((user) => {
			this.profileForm = this.formBuilder.group({
				name: new FormControl(user?.name, [Validators.required]),
				email: new FormControl(user?.email, [Validators.required, Validators.email]),
				phone: new FormControl(user?.phone, [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl(user?.country_code, [Validators.required]),
				profile_image_id: new FormControl(user?.profile_image_id),
			});

			this.flicker = true;

			if (user && user.store) {
				this.form = this.formBuilder.group({
					store_name: new FormControl(user.store.store_name, [Validators.required]),
					description: new FormControl(user.store.description, [Validators.required]),
					country_id: new FormControl(user.store?.country_id, [Validators.required]),
					state_id: new FormControl(user?.store?.state_id, [Validators.required]),
					city: new FormControl(user?.store?.city, [Validators.required]),
					address: new FormControl(user?.store?.address, [Validators.required]),
					pincode: new FormControl(user?.store?.pincode, [Validators.required]),
					store_logo_id: new FormControl(user?.store?.store_logo_id),
					hide_vendor_email: new FormControl(user?.store?.hide_vendor_email),
					hide_vendor_phone: new FormControl(user?.store?.hide_vendor_phone),
					facebook: new FormControl(user?.store?.facebook),
					instagram: new FormControl(user?.store?.instagram),
					pinterest: new FormControl(user?.store?.pinterest),
					youtube: new FormControl(user?.store?.youtube),
					twitter: new FormControl(user?.store?.twitter),
				});
			}

			setTimeout(() => (this.flicker = false), 200);
		});

		this.passwordForm = this.formBuilder.group(
			{
				current_password: new FormControl('', [Validators.required]),
				password: new FormControl('', [Validators.required]),
				password_confirmation: new FormControl('', [Validators.required]),
			},
			{ validator: CustomValidators.MatchValidator('password', 'password_confirmation') },
		);
	}

	countryChange(data: Select2UpdateEvent) {
		if (data && data?.value) {
			this.selectedCountryId.set(+data?.value);
			this.form.controls['state_id'].setValue('');
		} else {
			this.form.controls['state_id'].setValue('');
		}
	}

	// Replicates the former StateState.states selector: states optionally filtered by country.
	private filterStates(country_id?: number | null): Select2Data {
		const states = this.statesQuery.data() ?? [];
		const filtered = country_id ? states.filter((element) => element.country_id == country_id) : states;
		return filtered.map((st) => ({ label: st?.name, value: st?.id, country_id: st?.country_id })) as Select2Data;
	}

	get passwordMatchError() {
		return this.passwordForm?.getError('mismatch') && this.passwordForm?.get('password_confirmation')?.touched;
	}

	selectCode(data: Select2UpdateEvent) {
		this.profileForm.controls['country_code'].setValue(data?.value);
	}

	selectedFiles(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.profileForm.controls['profile_image_id'].setValue(data ? data.id : '');
		}
	}

	profileFormSubmit() {
		this.profileForm.markAllAsTouched();
		if (this.profileForm.valid) {
			// Update has no backend yet — profile value is ready to persist once the API exists.
		}
	}

	passwordFormSubmit() {
		this.passwordForm.markAllAsTouched();
		if (this.passwordForm.valid) {
			// Update has no backend yet — just reset the form.
			this.passwordForm.reset();
		}
	}

	selectStoreLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['store_logo_id'].setValue(data ? data.id : '');
		}
	}

	updateStore() {
		// Update has no backend yet — store value is ready to persist once the API exists.
	}
}

import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Data, Select2UpdateEvent, Select2Module } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { switchMap, map, takeUntil } from 'rxjs/operators';

import { CurrencyService } from '@data-access/services/currency.service';
import * as data from '@shared/data/currency';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

@Component({
	selector: 'app-form-currency',
	templateUrl: './form-currency.html',
	styleUrls: ['./form-currency.scss'],
	imports: [ReactiveFormsModule, FormFields, Select2Module, Button, TranslocoModule],
})
export class FormCurrency {
	private currencyService = inject(CurrencyService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	public id: number;
	public isBrowser: boolean;

	public symbolPosition: Select2Data = [
		{
			value: 'before_price',
			label: 'Before Price',
		},
		{
			value: 'after_price',
			label: 'After Price',
		},
	];

	private destroy$ = new Subject<void>();

	public currency = data.currency;
	public currency_dropdown: Select2Data = [];

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			code: new FormControl('', [Validators.required]),
			symbol: new FormControl('', [Validators.required]),
			no_of_decimal: new FormControl(0),
			exchange_rate: new FormControl('', [Validators.required]),
			symbol_position: new FormControl('', [Validators.required]),
			status: new FormControl(1),
		});
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.currencyService
						.getCurrencies()
						.pipe(map((res) => res.data.find((currency) => currency.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((currency) => {
				this.id = currency?.id!;
				this.form.patchValue({
					code: currency?.code,
					symbol: currency?.symbol,
					no_of_decimal: currency?.no_of_decimal,
					exchange_rate: currency?.exchange_rate,
					symbol_position: currency?.symbol_position,
					status: currency?.status,
				});
			});

		this.currency.forEach((data) => {
			this.currency_dropdown.push({
				label: data.currency_code,
				value: data.currency_code,
			});
		});
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate.
			void this.router.navigateByUrl('/currency');
		}
	}

	changeCurrency(data: Select2UpdateEvent) {
		let selected_currency = this.currency?.find((curr) => {
			return curr.currency_code === data.value;
		});
		this.form.patchValue({
			symbol: selected_currency?.currency_symbol,
		});
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}

import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, inject, input, PLATFORM_ID, Renderer2, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import {
	NgbCalendar,
	NgbDate,
	NgbDateParserFormatter,
	NgbDateStruct,
	NgbInputDatepicker,
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
} from '@ng-bootstrap/ng-bootstrap';
import { toObservable } from '@angular/core/rxjs-interop';
import { computed, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Select2, Select2Data, Select2Module, Select2SearchEvent } from 'ng-select2-component';
import { Observable, of, Subject } from 'rxjs';
import { debounceTime, map, switchMap, takeUntil } from 'rxjs/operators';

import { injectProductsQuery } from '@data-access/queries/product.queries';
import { SettingStore } from '@core/state/setting.store';
import { CouponService } from '@data-access/services/coupon.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ICoupon } from '@data-access/interfaces/coupon.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IValues } from '@data-access/interfaces/setting.interface';

function convertToNgbDate(date: NgbDateStruct): NgbDate {
	return new NgbDate(date.year, date.month, date.day);
}

@Component({
	selector: 'app-form-coupon',
	templateUrl: './form-coupon.html',
	styleUrls: ['./form-coupon.scss'],
	imports: [
		ReactiveFormsModule,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		FormFields,
		Select2Module,
		NgbInputDatepicker,
		NgbNavOutlet,
		Button,
		TranslateModule,
		AsyncPipe,
	],
})
export class FormCoupon {
	private couponService = inject(CouponService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private calendar = inject(NgbCalendar);
	formatter = inject(NgbDateParserFormatter);
	private renderer = inject(Renderer2);
	private document = inject<Document>(DOCUMENT);

	readonly type = input<string>(undefined);

	readonly nav = viewChild<NgbNav>('nav');

	public active = 'general';
	public tabError: string | null;
	public form: FormGroup;
	public id: number;

	public hoveredDate: NgbDate | null = null;
	public fromDate: NgbDate | null;
	public toDate: NgbDate | null;
	public data: ICoupon;
	private search = new Subject<string>();
	public isBrowser: boolean;

	public couponType: Select2Data = [
		{
			value: 'percentage',
			label: 'Percentage',
		},
		{
			value: 'free_shipping',
			label: 'Free Shipping',
		},
		{
			value: 'fixed',
			label: 'Fixed',
		},
	];

	private destroy$ = new Subject<void>();

	private readonly productParams = signal<Params>({ status: 1, paginate: 15 });
	private readonly productsQuery = injectProductsQuery(() => this.productParams());
	product$: Observable<Select2Data> = toObservable(
		computed(
			() =>
				this.productsQuery.data()?.data.map((res) => ({
					label: res?.name,
					value: res?.id,
					data: {
						type: res.type,
						name: res.name,
						slug: res.slug,
						stock_status: res.stock_status,
						image: res.product_thumbnail ? res.product_thumbnail.original_url : 'assets/images/product.png',
					},
				})) ?? [],
		),
	);
	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			title: new FormControl('', [Validators.required]),
			description: new FormControl('', [Validators.required]),
			code: new FormControl('', [Validators.required]),
			type: new FormControl('', [Validators.required]),
			amount: new FormControl(''),
			start_date: new FormControl('', [Validators.required]),
			end_date: new FormControl('', [Validators.required]),
			is_expired: new FormControl(1),
			is_first_order: new FormControl(),
			status: new FormControl(1),
			is_apply_all: new FormControl(0),
			products: new FormControl('', [Validators.required]),
			exclude_products: new FormControl(),
			min_spend: new FormControl('', [Validators.required]),
			is_unlimited: new FormControl(0),
			usage_per_coupon: new FormControl(),
			usage_per_customer: new FormControl(),
		});
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.couponService
						.getCoupons()
						.pipe(map((res) => res.data.find((coupon) => coupon.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((coupon) => {
				this.data = coupon!;
				this.id = coupon?.id!;
				this.fromDate = coupon?.start_date ? convertToNgbDate(this.formatter.parse(coupon.start_date)!) : null;
				this.toDate = coupon?.end_date ? convertToNgbDate(this.formatter.parse(coupon.end_date)!) : null;
				this.form.patchValue({
					title: coupon?.title,
					description: coupon?.description,
					code: coupon?.code,
					type: coupon?.type,
					amount: coupon?.amount,
					start_date: coupon?.start_date,
					end_date: coupon?.end_date,
					is_expired: coupon?.is_expired,
					is_first_order: coupon?.is_first_order,
					is_apply_all: Number(coupon?.is_apply_all),
					exclude_products: coupon?.exclude_products?.map((product) => product.id),
					products: coupon?.products?.map((product) => product.id),
					min_spend: coupon?.min_spend,
					is_unlimited: coupon?.is_unlimited,
					usage_per_coupon: coupon?.usage_per_coupon,
					usage_per_customer: coupon?.usage_per_customer,
					status: coupon?.status,
				});
			});

		this.search
			.pipe(debounceTime(300)) // Adjust the debounce time as needed (in milliseconds)
			.subscribe((inputValue) => {
				this.productParams.set({ status: 1, paginate: 15, search: inputValue });
				this.renderer.addClass(this.document.body, 'loader-none');
			});

		this.form.controls['is_expired'].valueChanges.subscribe((data) => {
			if (!data) {
				this.form.removeControl('start_date');
				this.form.removeControl('end_date');
			} else {
				this.form.setControl(
					'start_date',
					new FormControl(this.data ? this.data?.start_date : '', [Validators.required]),
				);
				this.form.setControl(
					'end_date',
					new FormControl(this.data ? this.data?.end_date : '', [Validators.required]),
				);
			}
		});

		this.form.controls['is_apply_all'].valueChanges.subscribe((data) => {
			if (!data) {
				this.form.removeControl('exclude_products');
				this.form.setControl(
					'products',
					new FormControl(
						this.data?.products?.map((product) => product.id),
						[Validators.required],
					),
				);
			} else {
				this.form.removeControl('products');
				this.form.setControl(
					'exclude_products',
					new FormControl(
						this.data?.exclude_products?.length
							? this.data?.exclude_products?.map((product) => product.id)
							: null,
					),
				);
			}
		});

		this.form.controls['is_unlimited'].valueChanges.subscribe((data) => {
			if (!data) {
				this.form.setControl('usage_per_coupon', new FormControl(this.data?.usage_per_coupon));
				this.form.setControl('usage_per_customer', new FormControl(this.data?.usage_per_customer));
			} else {
				this.form.removeControl('usage_per_coupon');
				this.form.removeControl('usage_per_customer');
			}
		});

		this.form.controls['type'].valueChanges.subscribe((data) => {
			if (data === 'free_shipping') {
				this.form.removeControl('amount');
			} else {
				this.form.setControl('amount', new FormControl(this.data?.amount, [Validators.required]));
			}
		});
	}

	productDropdown(event: Select2) {
		if (event['innerSearchText']) {
			this.search.next('');
		}
	}

	searchProduct(event: Select2SearchEvent) {
		this.search.next(event.search);
	}

	onDateSelection(date: NgbDate) {
		if (!this.fromDate && !this.toDate) {
			this.fromDate = date;
		} else if (this.fromDate && !this.toDate && date && date.after(this.fromDate)) {
			this.toDate = date;
		} else {
			this.toDate = null;
			this.fromDate = date;
		}

		if (this.fromDate)
			this.form.controls['start_date'].setValue(
				`${this.fromDate.year}-${this.fromDate.month}-${this.fromDate.day}`,
			);
		if (this.toDate)
			this.form.controls['end_date'].setValue(`${this.toDate?.year}-${this.toDate?.month}-${this.toDate?.day}`);
	}

	isHovered(date: NgbDate) {
		return (
			this.fromDate &&
			!this.toDate &&
			this.hoveredDate &&
			date.after(this.fromDate) &&
			date.before(this.hoveredDate)
		);
	}

	isInside(date: NgbDate) {
		return this.toDate && date.after(this.fromDate) && date.before(this.toDate);
	}

	isRange(date: NgbDate) {
		return (
			date.equals(this.fromDate) ||
			(this.toDate && date.equals(this.toDate)) ||
			this.isInside(date) ||
			this.isHovered(date)
		);
	}

	validateInput(currentValue: NgbDate | null, input: string): NgbDate | null {
		const parsed = this.formatter.parse(input);
		return parsed && this.calendar.isValid(NgbDate.from(parsed)) ? NgbDate.from(parsed) : currentValue;
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate.
			void this.router.navigateByUrl('/coupon');
			this.tabError = null;
		} else {
			const invalidField = Object?.keys(this.form?.controls).find((key) => this.form.controls[key].invalid);
			const div = document.querySelector(`#${invalidField}`)?.closest('div.tab')?.getAttribute('tab');
			if (div) {
				this.nav().select(div);
				this.tabError = div;
			}
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}

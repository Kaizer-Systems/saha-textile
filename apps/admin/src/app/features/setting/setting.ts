import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

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
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SettingStore } from '@core/state/setting.store';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { IDayInterval, IValues } from '@data-access/interfaces/setting.interface';
import { injectCurrenciesQuery } from '@data-access/queries/currency.queries';
import { SettingService } from '@data-access/services/setting.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import * as data from '@shared/data/time-zone';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';

@Component({
	selector: 'app-setting',
	templateUrl: './setting.html',
	styleUrls: ['./setting.scss'],
	imports: [
		PageWrapper,
		ReactiveFormsModule,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		FormFields,
		ImageUpload,
		Select2Module,
		Button,
		NgbNavOutlet,
		HasPermissionDirective,
		TranslocoModule,
		AsyncPipe,
	],
})
export class Setting {
	private settingService = inject(SettingService);
	private settingStore = inject(SettingStore);
	private formBuilder = inject(FormBuilder);

	private readonly currenciesQuery = injectCurrenciesQuery(() => ({ status: 1 }));
	readonly currencies = computed(
		() =>
			this.currenciesQuery.data()?.data.map((currency) => ({
				label: currency.code,
				value: currency.id,
			})) ?? [],
	);
	setting$: Observable<IValues | null> = toObservable(this.settingStore.setting);

	public form: FormGroup;
	public active = 'general';
	public active_payment = 1;
	public time_zone = data.time_zone;
	public active_analytics = 'facebook';
	public mail_mailer: Select2Data = [
		{
			value: 'sendmail',
			label: 'Sendmail',
		},
		{
			value: 'smtp',
			label: 'SMTP',
		},
		{
			value: 'mailgun',
			label: 'Mailgun',
		},
	];

	public encryption: Select2Data = [
		{
			value: 'ssl',
			label: 'SSL',
		},
		{
			value: 'tls',
			label: 'TLS',
		},
	];

	public language_direction: Select2Data = [
		{
			value: 'ltr',
			label: 'LTR',
		},
		{
			value: 'rtl',
			label: 'RTL',
		},
	];

	public mode: Select2Data = [
		{
			value: 'light-only',
			label: 'Light',
		},
		{
			value: 'dark-only',
			label: 'Dark',
		},
	];

	public isBrowser: boolean;

	constructor() {
		const formBuilder = this.formBuilder;
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = formBuilder.group({
			general: new FormGroup({
				light_logo_image_id: new FormControl(),
				dark_logo_image_id: new FormControl(),
				tiny_logo_image_id: new FormControl(),
				favicon_image_id: new FormControl(),
				site_title: new FormControl('', Validators.required),
				site_tagline: new FormControl(),
				default_timezone: new FormControl('Asia/Kolkata', Validators.required),
				default_currency_id: new FormControl(19, Validators.required),
				admin_site_language_direction: new FormControl('ltr'),
				min_order_amount: new FormControl(0, Validators.required),
				min_order_free_shipping: new FormControl(0, Validators.required),
				product_sku_prefix: new FormControl(),
				mode: new FormControl('light-only', Validators.required),
				copyright: new FormControl('Copyright Text Here'),
			}),
			activation: new FormGroup({
				multivendor: new FormControl(true),
				point_enable: new FormControl(true),
				coupon_enable: new FormControl(true),
				wallet_enable: new FormControl(true),
				stock_product_hide: new FormControl(true),
				store_auto_approve: new FormControl(true),
				product_auto_approve: new FormControl(true),
			}),
			wallet_points: new FormGroup({
				signup_points: new FormControl(100),
				min_per_order_amount: new FormControl(100),
				point_currency_ratio: new FormControl(30),
				reward_per_order_amount: new FormControl(''),
			}),
			email: new FormGroup({
				mail_host: new FormControl(),
				mail_port: new FormControl(465),
				mail_mailer: new FormControl('smtp'),
				mail_password: new FormControl(),
				mail_username: new FormControl(),
				mail_encryption: new FormControl('ssl'),
				mail_from_name: new FormControl(),
				mail_from_address: new FormControl(),
				mailgun_domain: new FormControl(),
				mailgun_secret: new FormControl(),
			}),
			vendor_commissions: new FormGroup({
				status: new FormControl(true),
				min_withdraw_amount: new FormControl(),
				default_commission_rate: new FormControl(),
				is_category_based_commission: new FormControl(true),
			}),
			refund: new FormGroup({
				status: new FormControl(true),
				refundable_days: new FormControl(),
			}),
			newsletter: new FormGroup({
				status: new FormControl(true),
				mailchip_api_key: new FormControl(),
				mailchip_list_id: new FormControl(),
			}),
			analytics: new FormGroup({
				facebook_pixel: new FormGroup({
					status: new FormControl(true),
					pixel_id: new FormControl(),
				}),
				google_analytics: new FormGroup({
					status: new FormControl(true),
					measurement_id: new FormControl(),
				}),
			}),
			delivery: new FormGroup({
				default_delivery: new FormControl(true),
				default: new FormGroup({
					title: new FormControl(),
					description: new FormControl(),
				}),
				same_day_delivery: new FormControl(true),
				same_day: new FormGroup({
					title: new FormControl(),
					description: new FormControl(),
				}),
				same_day_intervals: new FormArray([]),
			}),
			google_reCaptcha: new FormGroup({
				status: new FormControl(true),
				secret: new FormControl(),
				site_key: new FormControl(),
			}),
			payment_methods: new FormGroup({
				paypal: new FormGroup({
					status: new FormControl(true),
					client_id: new FormControl(),
					client_secret: new FormControl(),
					sandbox_mode: new FormControl(true),
				}),
				stripe: new FormGroup({
					key: new FormControl(),
					secret: new FormControl(),
					status: new FormControl(true),
				}),
				razorpay: new FormGroup({
					key: new FormControl(),
					secret: new FormControl(),
					status: new FormControl(true),
				}),
				mollie: new FormGroup({
					status: new FormControl(true),
					secret_key: new FormControl(),
				}),
				cod: new FormGroup({
					status: new FormControl(true),
				}),
			}),
			maintenance: new FormGroup({
				maintenance_mode: new FormControl(false),
				maintenance_image_id: new FormControl(),
			}),
		});
	}

	get sameDayIntervals(): FormArray {
		return (this.form.controls['delivery'] as FormArray).controls['same_day_intervals'] as FormArray;
	}

	ngOnInit() {
		this.patchForm();
	}

	patchForm() {
		this.settingService
			.getBackendSettingOption()
			.pipe(map((res) => res.values))
			.subscribe((option) => {
				this.form.patchValue({
					general: {
						light_logo_image_id: option?.general?.light_logo_image_id,
						dark_logo_image_id: option?.general?.dark_logo_image_id,
						favicon_image_id: option?.general?.favicon_image_id,
						tiny_logo_image_id: option?.general?.tiny_logo_image_id,
						site_title: option?.general?.site_title,
						site_tagline: option?.general?.site_tagline,
						default_timezone: option?.general?.default_timezone,
						default_currency_id: +option?.general?.default_currency_id!,
						admin_site_language_direction: option?.general?.admin_site_language_direction,
						min_order_amount: option?.general?.min_order_amount,
						min_order_free_shipping: option?.general?.min_order_free_shipping,
						product_sku_prefix: option?.general?.product_sku_prefix,
						mode: option?.general?.mode,
						copyright: option?.general?.copyright,
					},
					activation: {
						multivendor: option?.activation?.multivendor,
						point_enable: option?.activation?.point_enable,
						coupon_enable: option?.activation?.coupon_enable,
						wallet_enable: option?.activation?.wallet_enable,
						stock_product_hide: option?.activation?.stock_product_hide,
						store_auto_approve: option?.activation?.store_auto_approve,
						product_auto_approve: option?.activation?.product_auto_approve,
					},
					wallet_points: {
						signup_points: option?.wallet_points?.signup_points,
						min_per_order_amount: option?.wallet_points?.min_per_order_amount,
						point_currency_ratio: option?.wallet_points?.point_currency_ratio,
						reward_per_order_amount: option?.wallet_points?.reward_per_order_amount,
					},
					email: {
						mail_host: option?.email?.mail_host,
						mail_port: option?.email?.mail_port,
						mail_mailer: option?.email?.mail_mailer,
						mail_password: option?.email?.mail_password,
						mail_username: option?.email?.mail_username,
						mail_encryption: option?.email?.mail_encryption,
						mail_from_name: option?.email?.mail_from_name,
						mail_from_address: option?.email?.mail_from_address,
						mailgun_domain: option?.email?.mailgun_domain,
						mailgun_secret: option?.email?.mailgun_secret,
					},
					vendor_commissions: {
						status: option?.vendor_commissions?.status,
						min_withdraw_amount: option?.vendor_commissions?.min_withdraw_amount,
						default_commission_rate: option?.vendor_commissions?.default_commission_rate,
						is_category_based_commission: option?.vendor_commissions?.is_category_based_commission,
					},
					refund: {
						status: option?.refund?.status,
						refundable_days: option?.refund?.refundable_days,
					},
					newsletter: {
						mailchip_api_key: option?.newsletter?.mailchip_api_key,
						mailchip_list_id: option?.newsletter?.mailchip_list_id,
					},
					analytics: {
						facebook_pixel: {
							status: option?.analytics?.facebook_pixel?.status,
							pixel_id: option?.analytics?.facebook_pixel?.pixel_id,
						},
						google_analytics: {
							status: option?.analytics?.google_analytics?.status,
							measurement_id: option?.analytics?.google_analytics?.measurement_id,
						},
					},
					delivery: {
						default_delivery: 1,
						default: {
							title: option?.delivery?.default?.title,
							description: option?.delivery?.default?.description,
						},
						same_day_delivery: option?.delivery?.same_day_delivery,
						same_day: {
							title: option?.delivery?.same_day?.title,
							description: option?.delivery?.same_day?.description,
						},
					},
					google_reCaptcha: {
						secret: option?.google_reCaptcha?.secret,
						status: option?.google_reCaptcha?.status,
						site_key: option?.google_reCaptcha?.site_key,
					},
					payment_methods: {
						paypal: {
							status: option?.payment_methods?.paypal?.status,
							client_id: option?.payment_methods?.paypal?.client_id,
							client_secret: option?.payment_methods?.paypal?.client_secret,
							sandbox_mode: option?.payment_methods?.paypal?.sandbox_mode,
						},
						stripe: {
							key: option?.payment_methods?.stripe?.key,
							secret: option?.payment_methods?.stripe?.secret,
							status: option?.payment_methods?.stripe?.status,
						},
						razorpay: {
							key: option?.payment_methods?.razorpay?.key,
							secret: option?.payment_methods?.razorpay?.secret,
							status: option?.payment_methods?.razorpay?.status,
						},
						mollie: {
							status: option?.payment_methods?.mollie?.status,
							secret_key: option?.payment_methods?.mollie?.secret_key,
						},
						cod: {
							status: option?.payment_methods?.cod?.status,
						},
					},
					maintenance: {
						maintenance_mode: option?.maintenance?.maintenance_mode,
						maintenance_image_id: option?.maintenance?.maintenance_image_id,
					},
				});
				this.sameDayIntervals.clear();
				option?.delivery?.same_day_intervals?.forEach((delivery: IDayInterval) =>
					this.sameDayIntervals.push(
						this.formBuilder.group({
							title: new FormControl(delivery?.title),
							description: new FormControl(delivery?.description),
						}),
					),
				);
			});
	}

	selectLightLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['general']).controls['light_logo_image_id'].setValue(data ? data?.id : null);
		}
	}

	selectDarkLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['general']).controls['dark_logo_image_id'].setValue(data ? data?.id : null);
		}
	}

	selectTinyLogo(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['general']).controls['tiny_logo_image_id'].setValue(data ? data?.id : null);
		}
	}

	selectFavicon(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['general']).controls['favicon_image_id'].setValue(data ? data?.id : null);
		}
	}

	selectMaintenance(data: IAttachment) {
		if (!Array.isArray(data)) {
			(<FormGroup>this.form.controls['maintenance']).controls['maintenance_image_id'].setValue(
				data ? data?.id : null,
			);
		}
	}

	addDays(event: Event) {
		event.preventDefault();
		this.sameDayIntervals.push(
			this.formBuilder.group({
				title: new FormControl(),
				description: new FormControl(),
			}),
		);
	}

	remove(index: number) {
		if (this.sameDayIntervals.length <= 1) return;
		this.sameDayIntervals.removeAt(index);
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			// Update has no backend yet — the store's mock update keeps the seam.
			this.settingStore.update({ values: this.form.value });
		}
	}
}

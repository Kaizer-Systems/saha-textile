import { AsyncPipe } from '@angular/common';
import { Component, computed, DOCUMENT, ElementRef, inject, Renderer2, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { Select2, Select2Data, Select2Module, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { debounceTime, lastValueFrom, Observable, Subject } from 'rxjs';

import {
	AdminCustomersGateway,
	type AdminCustomer,
	type AdminCustomerListParams,
	type CustomerAddress,
} from '@core/admin-customers/admin-customers.gateway';
import { CartActions } from '@core/state/cart/cart.actions';
import { selectCartItems } from '@core/state/cart/cart.selectors';
import { LoaderStore } from '@core/state/loader.store';
import { SettingStore } from '@core/state/setting.store';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IOrderCheckout } from '@data-access/interfaces/order.interface';
import { IDeliveryBlock, IValues } from '@data-access/interfaces/setting.interface';
import { injectAdminCustomersQuery } from '@data-access/queries/admin-customers.queries';
import { Loader } from '@layout/loader/loader';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';

import { AddressBlock, type CheckoutAddressView } from './address-block/address-block';
import { DeliveryBlock } from './delivery-block/delivery-block';
import { AddAddressModal } from './modal/add-address-modal/add-address-modal';
import { AddCustomerModal } from './modal/add-customer-modal/add-customer-modal';
import { CouponModal } from './modal/coupon-modal/coupon-modal';
import { PaymentBlock } from './payment-block/payment-block';

// Static mock checkout totals (mirrors the former OrderState.checkout — real totals come from the API later).
const STATIC_CHECKOUT: IOrderCheckout = {
	total: {
		convert_point_amount: -10,
		convert_wallet_balance: -84.4,
		coupon_total_discount: 10,
		points: 300,
		points_amount: 10,
		shipping_total: 0,
		sub_total: 35.19,
		tax_total: 2.54,
		total: 37.73,
		wallet_balance: 84.4,
	},
} as IOrderCheckout;

interface CheckoutCustomerView {
	id: string;
	address: CheckoutAddressView[];
}

function mapAddress(address: CustomerAddress): CheckoutAddressView {
	return {
		id: address.id,
		title: address.label || address.fullName,
		street: address.line2 ? `${address.line1}, ${address.line2}` : address.line1,
		city: address.city,
		state: address.state ? { name: address.state } : null,
		country: { name: address.country },
		pincode: address.postalCode,
		phone: address.phone,
	};
}

function toCheckoutView(customer: AdminCustomer): CheckoutCustomerView {
	return {
		id: customer.id,
		address: (customer.addresses ?? []).map(mapAddress),
	};
}

@Component({
	selector: 'app-checkout',
	templateUrl: './checkout.html',
	styleUrls: ['./checkout.scss'],
	imports: [
		Loader,
		HasPermissionDirective,
		ReactiveFormsModule,
		Select2Module,
		AddressBlock,
		DeliveryBlock,
		PaymentBlock,
		NoData,
		Button,
		AddCustomerModal,
		AddAddressModal,
		CouponModal,
		TranslocoModule,
		CurrencySymbolPipe,
		AsyncPipe,
	],
})
export class Checkout {
	private router = inject(Router);
	private document = inject<Document>(DOCUMENT);
	private renderer = inject(Renderer2);
	private store = inject(Store);
	private settingStore = inject(SettingStore);
	private formBuilder = inject(FormBuilder);
	private readonly customersGateway = inject(AdminCustomersGateway);

	readonly loader = inject(LoaderStore);

	private readonly customerParams = signal<AdminCustomerListParams>({ pageSize: 15 });
	private readonly customersQuery = injectAdminCustomersQuery(() => this.customerParams());
	users$: Observable<Select2Data> = toObservable(
		computed(() => {
			const items = this.customersQuery.data()?.items ?? [];
			return items
				.filter((customer) => customer.status === 'active' || customer.status === 'pending')
				.map((customer) => ({
					label: customer.displayName || customer.email || customer.id,
					value: customer.id,
				}));
		}),
	);

	cartItem$: Observable<ICart[]> = this.store.select(selectCartItems);

	private readonly selectedUser = signal<CheckoutCustomerView | null>(null);
	selectedUser$: Observable<CheckoutCustomerView | null> = toObservable(this.selectedUser);
	setting$: Observable<IValues | null> = toObservable(this.settingStore.setting);

	readonly AddAddressModal = viewChild<AddAddressModal>('addAddressModal');
	readonly AddCustomerModal = viewChild<AddCustomerModal>('addCustomerModal');
	readonly CouponModal = viewChild<CouponModal>('couponModal');

	readonly cpnRef = viewChild<ElementRef<HTMLInputElement>>('cpn');

	public form: FormGroup;
	public coupon: boolean = true;
	public couponCode: string;
	public appliedCoupon: boolean = false;
	public couponError: string | null;
	public checkoutTotal: IOrderCheckout | null = null;
	public loading: boolean = false;
	private search = new Subject<string>();

	constructor() {
		this.store.dispatch(CartActions.loadCart());

		this.form = this.formBuilder.group({
			consumer_id: new FormControl('', [Validators.required]),
			products: this.formBuilder.array([], [Validators.required]),
			shipping_address_id: new FormControl('', [Validators.required]),
			billing_address_id: new FormControl('', [Validators.required]),
			points_amount: new FormControl(),
			wallet_balance: new FormControl(),
			coupon: new FormControl(),
			delivery_description: new FormControl('', [Validators.required]),
			delivery_interval: new FormControl(),
			payment_method: new FormControl('', [Validators.required]),
		});

		this.form.valueChanges.subscribe((_form) => {
			this.checkout();
		});
	}

	get productControl(): FormArray {
		return this.form.get('products') as FormArray;
	}

	ngOnInit() {
		this.cartItem$.subscribe((items) => {
			if (!items?.length) {
				void this.router.navigateByUrl('/order/create');
			}
			this.productControl.clear();
			items!.forEach((item: ICart) =>
				this.productControl.push(
					this.formBuilder.group({
						product_id: new FormControl(item?.product_id, [Validators.required]),
						variation_id: new FormControl(item?.variation_id ? item?.variation_id : ''),
						quantity: new FormControl(item?.quantity),
					}),
				),
			);
		});

		this.search.pipe(debounceTime(300)).subscribe((inputValue) => {
			const next: AdminCustomerListParams = { pageSize: 15 };
			if (inputValue.trim()) next.q = inputValue.trim();
			this.customerParams.set(next);
			this.renderer.addClass(this.document.body, 'loader-none');
		});
	}

	selectUser(data: Select2UpdateEvent) {
		if (data?.value) {
			this.form.controls['shipping_address_id'].reset();
			this.form.controls['billing_address_id'].reset();
			this.form.controls['points_amount'].reset();
			this.form.controls['wallet_balance'].reset();
			this.form.controls['coupon'].reset();
			void lastValueFrom(this.customersGateway.get(String(data.value))).then((customer) => {
				this.selectedUser.set(toCheckoutView(customer));
			});
		}
	}

	userDropdown(event: Select2) {
		if (event['innerSearchText']) {
			this.search.next('');
		}
	}

	searchUser(event: Select2SearchEvent) {
		this.search.next(event.search);
	}

	onCustomerCreated() {
		this.customerParams.set({ ...this.customerParams() });
	}

	selectShippingAddress(id: string | number) {
		if (id) {
			this.form.controls['shipping_address_id'].setValue(id);
		}
	}

	selectBillingAddress(id: string | number) {
		if (id) {
			this.form.controls['billing_address_id'].setValue(id);
		}
	}

	selectDelivery(value: IDeliveryBlock) {
		this.form.controls['delivery_description'].setValue(value?.delivery_description);
		this.form.controls['delivery_interval'].setValue(value?.delivery_interval);
	}

	selectPaymentMethod(value: string) {
		this.form.controls['payment_method'].setValue(value);
	}

	showCoupon() {
		this.coupon = true;
	}

	setCoupon(value?: string) {
		this.couponError = null;
		if (value) this.form.controls['coupon'].setValue(value);
		else this.form.controls['coupon'].reset();
		// Checkout has no backend yet — apply the static totals locally.
		this.checkoutTotal = STATIC_CHECKOUT;
		this.appliedCoupon = value ? true : false;
		this.couponError = null;
	}

	couponRemove() {
		this.setCoupon();
	}

	checkout() {
		if (this.form.valid) {
			this.loading = true;
			// Checkout has no backend yet — apply the static totals locally.
			this.checkoutTotal = STATIC_CHECKOUT;
			this.loading = false;
		}
	}

	placeorder() {
		if (this.form.valid) {
			if (!this.cpnRef().nativeElement.value) {
				this.form.controls['coupon'].reset();
			}
			// Place order has no backend yet — navigate to the mock order details.
			void this.router.navigateByUrl('/order/details/1000');
		}
	}

	ngOnDestroy() {
		this.selectedUser.set(null);
		this.checkoutTotal = null;
		this.form.reset();
		this.search.next('');
		this.search.complete();
	}
}

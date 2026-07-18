import { AsyncPipe } from '@angular/common';
import { Component, computed, DOCUMENT, ElementRef, inject, Renderer2, signal, viewChild } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { Select2, Select2Data, Select2Module, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { debounceTime, Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

import { CartActions } from '@core/state/cart/cart.actions';
import { selectCartItems } from '@core/state/cart/cart.selectors';
import { LoaderStore } from '@core/state/loader.store';
import { SettingStore } from '@core/state/setting.store';
import { ICart } from '@data-access/interfaces/cart.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IOrderCheckout } from '@data-access/interfaces/order.interface';
import { IDeliveryBlock, IValues } from '@data-access/interfaces/setting.interface';
import { IUser } from '@data-access/interfaces/user.interface';
import { injectUsersQuery } from '@data-access/queries/user.queries';
import { UserService } from '@data-access/services/user.service';
import { Loader } from '@layout/loader/loader';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { Button } from '@shared/ui/button/button';
import { NoData } from '@shared/ui/no-data/no-data';

import { AddressBlock } from './address-block/address-block';
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
	private userService = inject(UserService);

	readonly loader = inject(LoaderStore);

	private readonly userParams = signal<Params>({ role: 'consumer', status: 1, paginate: 15 });
	private readonly usersQuery = injectUsersQuery(() => this.userParams());
	users$: Observable<Select2Data> = toObservable(
		computed(() => this.usersQuery.data()?.data.map((user) => ({ label: user.name, value: user.id })) ?? []),
	);

	cartItem$: Observable<ICart[]> = this.store.select(selectCartItems);

	private readonly selectedUser = signal<IUser | null>(null);
	selectedUser$: Observable<IUser | null> = toObservable(this.selectedUser);
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

		this.search
			.pipe(debounceTime(300)) // Adjust the debounce time as needed (in milliseconds)
			.subscribe((inputValue) => {
				this.userParams.set({ role: 'consumer', status: 1, paginate: 15, search: inputValue });
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
			this.userService
				.getUsers()
				.pipe(map((res) => res.data.find((user) => user.id == Number(data?.value)) ?? null))
				.subscribe((user) => this.selectedUser.set(user));
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

	selectShippingAddress(id: number) {
		if (id) {
			this.form.controls['shipping_address_id'].setValue(Number(id));
		}
	}

	selectBillingAddress(id: number) {
		if (id) {
			this.form.controls['billing_address_id'].setValue(Number(id));
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

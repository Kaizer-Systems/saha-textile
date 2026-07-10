import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, PLATFORM_ID, viewChild } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
  FormArray,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { AddressBlock } from './address-block/address-block';
import { DeliveryBlock } from './delivery-block/delivery-block';
import { PaymentBlock } from './payment-block/payment-block';
import { GetCartItemsAction } from '@data-access/actions/cart.action';
import { GetSettingOptionAction } from '@data-access/actions/setting.action';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { Loader } from '@shared/ui/loader/loader';
import { AddressModal } from '@shared/ui/modal/address-modal/address-modal';
import { NoData } from '@shared/ui/no-data/no-data';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { ICart } from '@data-access/interfaces/cart.interface';
import { IOrderCheckout } from '@data-access/interfaces/order.interface';
import { IValues, IDeliveryBlock } from '@data-access/interfaces/setting.interface';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { AccountState } from '@data-access/states/account.state';
import { CartState } from '@data-access/states/cart.state';
import { SettingState } from '@data-access/states/setting.state';

// Static mock checkout totals (was the NGXS CheckoutAction reducer — no backend
// yet; real values get computed server-side later).
const CHECKOUT_TOTAL: IOrderCheckout = {
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
};

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.html',
  styleUrls: ['./checkout.scss'],
  providers: [CurrencySymbolPipe],
  imports: [
    Breadcrumb,
    AddressBlock,
    DeliveryBlock,
    PaymentBlock,
    NoData,
    ReactiveFormsModule,
    Loader,
    Button,
    AddressModal,
    AsyncPipe,
    CurrencySymbolPipe,
    TranslateModule,
  ],
})
export class Checkout {
  private store = inject(Store);
  private formBuilder = inject(FormBuilder);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);

  public breadcrumb: IBreadcrumb = {
    title: 'Checkout',
    items: [{ label: 'Checkout', active: true }],
  };

  user$: Observable<IAccountUser> = inject(Store).select(
    AccountState.user,
  ) as Observable<IAccountUser>;
  cartItem$: Observable<ICart[]> = inject(Store).select(CartState.cartItems);
  setting$: Observable<IValues> = inject(Store).select(SettingState.setting) as Observable<IValues>;

  readonly AddressModal = viewChild<AddressModal>('addressModal');
  readonly cpnRef = viewChild<ElementRef<HTMLInputElement>>('cpn');

  public form: FormGroup;
  public coupon: boolean = true;
  public couponCode: string;
  public appliedCoupon: boolean = false;
  public couponError: string | null;
  public checkoutTotal: IOrderCheckout | null;
  public loading: boolean = false;

  constructor() {
    this.store.dispatch(new GetCartItemsAction());
    this.store.dispatch(new GetSettingOptionAction());

    this.form = this.formBuilder.group({
      products: this.formBuilder.array([], [Validators.required]),
      shipping_address_id: new FormControl('', [Validators.required]),
      billing_address_id: new FormControl('', [Validators.required]),
      points_amount: new FormControl(false),
      wallet_balance: new FormControl(false),
      coupon: new FormControl(),
      delivery_description: new FormControl('', [Validators.required]),
      delivery_interval: new FormControl(),
      payment_method: new FormControl('', [Validators.required]),
    });
  }

  get productControl(): FormArray {
    return this.form.get('products') as FormArray;
  }

  ngOnInit() {
    this.cartItem$.subscribe(items => {
      if (!items.length) {
        return;
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
  }

  selectShippingAddress(id: number) {
    if (id) {
      this.form.controls['shipping_address_id'].setValue(Number(id));
      this.checkout();
    }
  }

  selectBillingAddress(id: number) {
    if (id) {
      this.form.controls['billing_address_id'].setValue(Number(id));
      this.checkout();
    }
  }

  selectDelivery(value: IDeliveryBlock) {
    this.form.controls['delivery_description'].setValue(value?.delivery_description);
    this.form.controls['delivery_interval'].setValue(value?.delivery_interval);
    this.checkout();
  }

  selectPaymentMethod(value: string) {
    this.form.controls['payment_method'].setValue(value);
    this.checkout();
  }

  togglePoint(event: Event) {
    this.form.controls['points_amount'].setValue((<HTMLInputElement>event.target)?.checked);
    this.checkout();
  }

  toggleWallet(event: Event) {
    this.form.controls['wallet_balance'].setValue((<HTMLInputElement>event.target)?.checked);
    this.checkout();
  }

  showCoupon() {
    this.coupon = true;
  }

  setCoupon(value?: string) {
    this.couponError = null;

    if (value) this.form.controls['coupon'].setValue(value);
    else this.form.controls['coupon'].reset();

    // Checkout totals are a client-side mock now (was CheckoutAction) — compute
    // synchronously, no dispatch/observable.
    this.checkoutTotal = CHECKOUT_TOTAL;
    this.appliedCoupon = value ? true : false;
    this.couponError = null;
  }

  couponRemove() {
    this.setCoupon();
  }

  checkout() {
    // If has coupon error while checkout
    if (this.couponError) {
      this.couponError = null;
      this.cpnRef()!.nativeElement.value = '';
      this.form.controls['coupon'].reset();
    }

    if (this.form.valid) {
      this.loading = true;
      this.checkoutTotal = CHECKOUT_TOTAL;
      this.loading = false;
    }
  }

  placeorder() {
    if (this.form.valid) {
      const cpnRef = this.cpnRef();
      if (cpnRef && !cpnRef.nativeElement.value) {
        this.form.controls['coupon'].reset();
      }
      // Place order has no backend yet — was PlaceOrderAction (navigate to a stub order).
      void this.router.navigateByUrl('/account/order/details/1000');
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      this.checkoutTotal = null; // was ClearAction
      this.form.reset();
    }
  }
}

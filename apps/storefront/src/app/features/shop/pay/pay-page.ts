import { DOCUMENT } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, map } from 'rxjs';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { shopMoney } from '@features/shop/checkout/checkout';

/**
 * Pay for your order (orders brief shop10, shop11; concern K1): the order, where it goes and the total,
 * and Pay, which only then goes to the gateway's own request. An expired link charges nothing and says
 * how to ask for a new one: "Call us" and "Email us" as plain tel: and mailto: links from the store's
 * contact settings (owner, 20 Nov: normal-size buttons, no number or address in the button text).
 */
@Component({
	selector: 'app-pay-page',
	template: `
		<section class="checkout-section-2 section-b-space">
			<div class="container-fluid-lg">
				@if (view.data(); as page) {
					@switch (page.state) {
						@case ('payable') {
							<div class="title-header mb-3">
								<h2 class="mb-1">{{ 'pay_title' | transloco }}</h2>
								<p class="text-content mb-0">
									{{ 'pay_lead' | transloco: { number: page.orderNumber, until: until(page.expiresAt) } }}
								</p>
							</div>
							<div class="row g-sm-4 g-3">
								<div class="col-xxl-8 col-xl-7">
									<div class="left-sidebar-checkout">
										<div class="checkout-detail-box">
											<ul>
												<li>
													<div class="checkout-icon"><i class="ri-map-pin-line"></i></div>
													<div class="checkout-box">
														<div class="checkout-title">
															<h4>{{ 'chk_delivery_address' | transloco }}</h4>
														</div>
														<div class="checkout-detail">
															<p class="text-content mb-0">
																{{ page.deliveryCity }}@if (page.deliveryCountry) { , {{ page.deliveryCountry }} }
															</p>
														</div>
													</div>
												</li>
												<li>
													<div class="checkout-icon"><i class="ri-bank-card-line"></i></div>
													<div class="checkout-box">
														<div class="checkout-title">
															<h4>{{ 'chk_payment' | transloco }}</h4>
														</div>
														<div class="checkout-detail">
															<p class="text-content mb-0">
																{{ (page.currency === 'INR' ? 'chk_pay_inr_help' : 'pay_paypal_help') | transloco }}
															</p>
														</div>
													</div>
												</li>
											</ul>
										</div>
									</div>
								</div>
								<div class="col-xxl-4 col-xl-5">
									<div class="card pos-detail-card">
										<div class="card-body">
											<div class="title-header">
												<div class="d-flex align-items-center">
													<h5>{{ 'chk_checkout' | transloco }}</h5>
												</div>
											</div>
											<div class="product-details">
												<ul class="cart-listing">
													@for (item of page.items; track $index) {
														<li>
															<img
																[src]="item.imageUrl ?? 'assets/images/product.png'"
																class="img-fluid"
																alt=""
															/>
															<div class="cart-content">
																<h4>{{ item.title }}</h4>
																<h5 class="text-theme">× {{ item.quantity }}</h5>
															</div>
														</li>
													}
												</ul>
											</div>
											<ul class="summary-total">
												<li class="list-total">
													<h4>{{ 'chk_total' | transloco }}</h4>
													<h4 class="price">{{ money(page.amount, page.currency) }}</h4>
												</li>
											</ul>
											<button
												type="button"
												class="btn btn-animation proceed-btn w-100 mt-3"
												(click)="pay(page.payUrl)"
											>
												{{
													(page.currency === 'INR' ? 'chk_pay_amount' : 'chk_pay_paypal')
														| transloco: { amount: money(page.amount, page.currency) }
												}}
											</button>
										</div>
									</div>
								</div>
							</div>
						}
						@case ('paid') {
							<div class="row justify-content-center">
								<div class="col-xl-6 col-lg-8">
									<div class="card pos-detail-card">
										<div class="card-body p-5 text-center">
											<i class="ri-checkbox-circle-line fs-1 text-success"></i>
											<h3 class="mt-3">{{ 'pay_paid_title' | transloco }}</h3>
											<p class="text-content mb-0">{{ 'pay_paid_text' | transloco: { number: page.orderNumber } }}</p>
										</div>
									</div>
								</div>
							</div>
						}
						@case ('expired') {
							<div class="row justify-content-center">
								<div class="col-xl-6 col-lg-8">
									<div class="card pos-detail-card">
										<div class="card-body p-5 text-center">
											<i class="ri-time-line fs-1 theme-color"></i>
											<h3 class="mt-3">{{ 'pay_expired_title' | transloco }}</h3>
											<p class="text-content">{{ 'pay_expired_text' | transloco: { number: page.orderNumber } }}</p>
											<div class="d-flex justify-content-center mt-3 gap-2">
												@if (page.contactPhone) {
													<a
														class="btn btn-animation btn-md"
														[href]="tel(page.contactPhone)"
													>
														{{ 'pay_call_us' | transloco }}
													</a>
												}
												@if (page.contactEmail) {
													<a
														class="btn btn-theme-outline btn-md"
														[href]="'mailto:' + page.contactEmail"
													>
														{{ 'pay_email_us' | transloco }}
													</a>
												}
											</div>
										</div>
									</div>
								</div>
							</div>
						}
					}
				} @else if (view.isError()) {
					<p class="text-content text-center mb-0">{{ 'pay_not_found' | transloco }}</p>
				}
			</div>
		</section>
	`,
	imports: [TranslocoModule],
})
export class PayPage {
	private readonly route = inject(ActivatedRoute);
	private readonly gateway = inject(CheckoutGateway);
	private readonly doc = inject(DOCUMENT);

	readonly token = toSignal(this.route.paramMap.pipe(map((params) => params.get('token'))), { initialValue: null });
	readonly view = injectQuery(() => ({
		queryKey: ['pay-page', this.token()],
		queryFn: () => firstValueFrom(this.gateway.payPage(this.token() as string)),
		enabled: !!this.token(),
		retry: false,
	}));
	readonly ready = computed(() => !!this.view.data());

	money(amount: number, currency: string): string {
		return shopMoney(amount, currency);
	}

	until(at: string): string {
		return new Date(at).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Kolkata',
		});
	}

	tel(phone: string): string {
		return `tel:${phone.replace(/[^+\d]/g, '')}`;
	}

	/** Pay goes to the gateway's own request only now (K1). */
	pay(url: string): void {
		this.doc.location.assign(url);
	}
}

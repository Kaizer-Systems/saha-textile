import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { SettingStore } from '@core/state/setting.store';

import type { CheckoutPaymentOutcome } from '@saha-textile/contracts';

/** The currencies the popups offer, the billing country's first (shop04, shop05, shop09). */
export const POPUP_CURRENCIES: ReadonlyArray<{ code: string; symbol: string; name: string }> = [
	{ code: 'INR', symbol: '₹', name: 'cur_inr' },
	{ code: 'GBP', symbol: '£', name: 'cur_gbp' },
	{ code: 'USD', symbol: 'US$', name: 'cur_usd' },
	{ code: 'EUR', symbol: '€', name: 'cur_eur' },
];

export function popupCurrencies(first: string | null, withRupees: boolean) {
	const list = POPUP_CURRENCIES.filter((row) => withRupees || row.code !== 'INR');
	const lead = list.find((row) => row.code === first);
	return lead ? [lead, ...list.filter((row) => row !== lead)] : list;
}

/**
 * Back from the gateway (orders brief OD1; shipping brief shop04, shop05): the server asks the gateway
 * itself before anything is marked paid. Paid → the order is placed. Not paid → the approved popup:
 * "Please choose your currency" after PayPal, or "Switch to your region’s currency" when the INR gateway
 * refused a card from abroad; picking a currency goes back to checkout in it.
 */
@Component({
	selector: 'app-payment-return',
	template: `
		<section class="checkout-section-2 section-b-space">
			<div class="container-fluid-lg">
				<div class="row justify-content-center">
					<div class="col-xl-6 col-lg-8">
						<div class="card pos-detail-card">
							<div class="card-body p-5 text-center">
								@if (outcome(); as result) {
									@switch (result.result) {
										@case ('paid') {
											<i class="ri-checkbox-circle-line fs-1 text-success"></i>
											<h3 class="mt-3">{{ 'ret_paid_title' | transloco }}</h3>
											<p class="text-content">{{ 'ret_paid_text' | transloco: { number: result.orderNumber } }}</p>
											<a
												class="btn btn-animation btn-md mt-2"
												[routerLink]="['/account/order', result.orderId]"
											>
												{{ 'ret_see_order' | transloco }}
											</a>
										}
										@case ('pending') {
											<i class="ri-time-line fs-1 theme-color"></i>
											<h3 class="mt-3">{{ 'ret_pending_title' | transloco }}</h3>
											<p class="text-content mb-0">{{ 'ret_pending_text' | transloco }}</p>
										}
										@case ('refunded') {
											<i class="ri-refund-2-line fs-1 theme-color"></i>
											<h3 class="mt-3">{{ 'ret_refunded_title' | transloco }}</h3>
											<p class="text-content mb-0">{{ 'ret_refunded_text' | transloco }}</p>
										}
										@default {
											<i [class]="(result.popup === 'switchToRegionCurrency' ? 'ri-bank-card-line' : 'ri-exchange-funds-line') + ' fs-1 theme-color'"></i>
											<h3 class="mt-3">
												{{ (result.popup === 'switchToRegionCurrency' ? 'ret_switch_title' : 'ret_choose_title') | transloco }}
											</h3>
											<p class="text-content">
												{{ (result.popup === 'switchToRegionCurrency' ? 'ret_switch_text' : result.popup ? 'ret_choose_text' : 'ret_failed_text') | transloco }}
											</p>
											@if (result.popup) {
												<div class="text-start mt-3">
													@for (row of choices(); track row.code) {
														<button
															type="button"
															class="btn btn-md d-flex justify-content-between align-items-center mb-2 w-100"
															[class.theme-bg-color]="picked() === row.code"
															[class.text-light]="picked() === row.code"
															[class.btn-theme-outline]="picked() !== row.code"
															(click)="picked.set(row.code)"
														>
															<span><b>{{ row.symbol }}</b> {{ row.name | transloco }}</span>
															<small>
																{{ (row.code === 'INR' ? 'ret_inr_ways' : row.code === result.firstCurrency && result.popup === 'switchToRegionCurrency' ? 'ret_from_billing' : 'ret_paypal') | transloco }}
															</small>
														</button>
													}
												</div>
											}
											<div class="button-box d-flex justify-content-center mt-3 gap-2">
												<a
													class="btn btn-md fw-bold btn-theme-outline"
													[routerLink]="['/checkout']"
												>
													{{ (result.popup === 'switchToRegionCurrency' ? 'ret_try_another_card' : 'ret_close') | transloco }}
												</a>
												@if (result.popup) {
													<button
														type="button"
														class="btn theme-bg-color btn-md fw-bold text-light"
														(click)="continueIn()"
													>
														{{ 'ret_continue_in' | transloco: { symbol: pickedSymbol() } }}
													</button>
												}
											</div>
										}
									}
								} @else if (failed()) {
									<p class="text-content mb-0">{{ 'ret_check_failed' | transloco }}</p>
								} @else {
									<p class="text-content mb-0">{{ 'ret_checking' | transloco }}</p>
								}
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	`,
	imports: [RouterLink, TranslocoModule],
})
export class PaymentReturn implements OnInit {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(CheckoutGateway);
	private readonly settings = inject(SettingStore);

	readonly outcome = signal<CheckoutPaymentOutcome | null>(null);
	readonly failed = signal(false);
	readonly picked = signal<string>('INR');
	readonly choices = computed(() => {
		const result = this.outcome();
		return popupCurrencies(result?.firstCurrency ?? null, result?.popup !== 'switchToRegionCurrency');
	});
	readonly pickedSymbol = computed(() => POPUP_CURRENCIES.find((row) => row.code === this.picked())?.symbol ?? '');

	async ngOnInit(): Promise<void> {
		const query = this.route.snapshot.queryParamMap;
		const attempt = query.get('attempt');
		if (!attempt) {
			this.failed.set(true);
			return;
		}
		const token = query.get('token');
		try {
			const result = await firstValueFrom(
				this.gateway.confirm(attempt, {
					...(token && /^[A-Z0-9]{5,40}$/.test(token) ? { token } : {}),
					cancelled: query.get('cancelled') === '1' || query.has('cancel'),
				}),
			);
			this.outcome.set(result);
			this.picked.set(this.choices()[0]?.code ?? 'INR');
		} catch {
			this.failed.set(true);
		}
	}

	/** "Continue in ₹/£": checkout again in the picked currency. */
	continueIn(): void {
		const row = POPUP_CURRENCIES.find((item) => item.code === this.picked());
		if (!row) return;
		this.settings.setCurrency({ ...(this.settings.selectedCurrency() ?? {}), code: row.code, symbol: row.symbol } as never);
		void this.router.navigate(['/checkout']);
	}
}

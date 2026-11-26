import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';

import type { CheckoutPaymentOutcome } from '@saha-textile/contracts';

/** What the checkout needs to show after a payment that didn't go through (history state, never the URL). */
export interface ReturnedPayment {
	popup: CheckoutPaymentOutcome['popup'];
	firstCurrency: string | null;
}

/** The results that stay on this page; any other goes back to the checkout. */
const SHOWN_HERE: ReadonlyArray<CheckoutPaymentOutcome['result']> = ['paid', 'pending', 'refunded'];

/**
 * Back from the gateway (orders brief OD1; shipping brief shop04, shop05): the server asks the gateway
 * itself before anything is marked paid. Paid, pending and refunded are said here. Not paid → back to
 * the checkout, which opens the approved popup over itself (shop04 "Please choose your currency" after
 * PayPal, shop05 "Switch to your region’s currency" when the INR gateway refused a card from abroad) or,
 * with no popup, says the payment didn't go through.
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
											<p class="text-content">
												{{ 'ret_paid_text' | transloco: { number: result.orderNumber } }}
											</p>
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

	readonly outcome = signal<CheckoutPaymentOutcome | null>(null);
	readonly failed = signal(false);

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
			if (SHOWN_HERE.includes(result.result)) {
				this.outcome.set(result);
				return;
			}
			const paymentOutcome: ReturnedPayment = { popup: result.popup, firstCurrency: result.firstCurrency };
			// Replaces this page in the history, so Back never asks the gateway again.
			await this.router.navigate(['/checkout'], { replaceUrl: true, state: { paymentOutcome } });
		} catch {
			this.failed.set(true);
		}
	}
}

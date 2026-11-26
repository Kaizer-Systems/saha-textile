import { Component, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { CouponsGateway } from '@core/coupons/coupons.gateway';
import { apiProblem, rupees } from '@core/purchasing/purchasing-format';

import type { AdminOrderCreate, CouponOption } from '@saha-textile/contracts';

/**
 * Apply a coupon at the admin checkout (brief cp06): type a code, or pick from the coupons this order
 * can use, each with what it would take off now and, for the others, why it can't be used. Closes
 * with the chosen code.
 */
@Component({
	selector: 'app-order-coupon-popup',
	template: `
		<div class="modal-header">
			<h2 id="order_coupon_popup_title">{{ 'ord_apply_coupon' | transloco }}</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body theme-form">
			<div class="input-group mb-3">
				<input
					class="form-control text-uppercase"
					maxlength="24"
					ngbAutofocus
					[placeholder]="'ord_type_a_code' | transloco"
					[attr.aria-label]="'ord_coupon_code' | transloco"
					[value]="code()"
					(input)="code.set($any($event.target).value)"
					(keydown.enter)="choose(code())"
				/>
				<button
					type="button"
					class="btn btn-theme"
					[disabled]="!code().trim()"
					(click)="choose(code())"
				>
					{{ 'ord_apply' | transloco }}
				</button>
			</div>
			<p class="small text-muted">{{ 'ord_coupons_this_order_can_use' | transloco }}</p>
			@if (options(); as list) {
				@for (option of list; track option.couponId) {
					<div
						class="d-flex justify-content-between align-items-center mb-2 gap-2 rounded border p-2"
						[class.opacity-50]="!!option.refusal"
					>
						<div>
							<b>{{ option.code }}</b>
							<div class="small text-muted">{{ option.title }}</div>
						</div>
						<div class="text-end">
							@if (option.refusal) {
								<div class="small text-muted">
									{{ 'ord_coupon_refusal_' + option.refusal | transloco }}
								</div>
							} @else {
								<div class="small fw-bold text-success">−{{ money(option.wouldTakeINR) }}</div>
								<button
									type="button"
									class="btn btn-outline btn-sm mt-1"
									(click)="choose(option.code)"
								>
									{{ 'ord_apply' | transloco }}
								</button>
							}
						</div>
					</div>
				} @empty {
					<p class="text-muted mb-0">{{ 'ord_no_coupons_to_use' | transloco }}</p>
				}
			} @else if (error(); as problem) {
				<div
					class="alert alert-warning d-flex align-items-start mb-0 gap-2"
					role="alert"
				>
					<i class="ri-error-warning-line mt-1"></i>
					<div>{{ problem }}</div>
				</div>
			} @else {
				<p class="text-muted mb-0">{{ 'loading' | transloco }}</p>
			}
		</div>
		<div class="modal-footer">
			<div class="left-part"></div>
			<div class="right-part">
				<button
					type="button"
					class="btn btn-outline"
					(click)="modal.dismiss()"
				>
					{{ 'close' | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class OrderCouponPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(CouponsGateway);
	private readonly transloco = inject(TranslocoService);

	readonly code = signal('');
	readonly options = signal<CouponOption[] | null>(null);
	readonly error = signal<string | null>(null);

	async start(body: AdminOrderCreate): Promise<void> {
		try {
			this.options.set(await firstValueFrom(this.gateway.checkoutOptions(body)));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	money(amount: number): string {
		return rupees(amount);
	}

	choose(code: string): void {
		const clean = code.trim().toUpperCase();
		if (clean) this.modal.close(clean);
	}
}

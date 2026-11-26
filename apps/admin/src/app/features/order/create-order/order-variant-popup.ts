import { Component, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { money } from '@core/orders/order-format';
import { OrdersGateway } from '@core/orders/orders.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';

import { stockWords } from './order-product-card';

import type { AdminProductCard, AdminVariantChoice, AdminVariantChoices } from '@saha-textile/contracts';

/**
 * Choose a variant (a colour, design or size) of a product on Create order, each priced for the
 * buyer by the server. A variant the zone doesn't price, or with none left, can't be picked. Closes
 * with the chosen variant.
 */
@Component({
	selector: 'app-order-variant-popup',
	template: `
		<div class="modal-header">
			<h2 id="order_variant_popup_title">{{ choices()?.title ?? card()?.title }}</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body">
			@if (choices(); as list) {
				@if (list.items.length) {
					<div class="table-responsive datatable-wrapper border-table">
						<table class="all-package theme-table no-footer table">
							<thead>
								<tr>
									<th>{{ 'ord_variant' | transloco }}</th>
									<th>{{ 'ord_col_stock' | transloco }}</th>
									<th class="text-end">{{ 'ord_col_price' | transloco }}</th>
									<th>
										<span class="visually-hidden">{{ 'add' | transloco }}</span>
									</th>
								</tr>
							</thead>
							<tbody>
								@for (row of list.items; track row.variationId) {
									<tr [class.text-muted]="row.price === null || row.stock === 0">
										<td>
											<div class="text-start">
												<h6 class="mb-0">{{ row.label }}</h6>
												<small class="text-muted">{{ row.sku }}</small>
											</div>
										</td>
										<td>{{ stock(row, list) }}</td>
										<td class="text-end text-nowrap">
											@if (row.price === null) {
												<span class="text-danger">{{ 'ord_zone_no_price' | transloco }}</span>
											} @else {
												{{ price(row) }}
											}
										</td>
										<td class="text-end">
											<button
												type="button"
												class="btn btn-theme btn-sm"
												[disabled]="row.price === null || row.stock === 0"
												(click)="modal.close(row)"
											>
												<i class="ri-add-line me-1"></i>
												{{ 'add' | transloco }}
											</button>
										</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				} @else {
					<p class="text-muted mb-0">{{ 'ord_no_variants' | transloco }}</p>
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
	`,
	imports: [TranslocoModule],
})
export class OrderVariantPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly card = signal<AdminProductCard | null>(null);
	readonly currency = signal('INR');
	readonly choices = signal<AdminVariantChoices | null>(null);
	readonly error = signal<string | null>(null);

	async start(card: AdminProductCard, currency: string, businessId: string | null): Promise<void> {
		this.card.set(card);
		this.currency.set(currency);
		try {
			this.choices.set(
				await firstValueFrom(
					this.gateway.variantChoices(card.productId, { currency, ...(businessId ? { businessId } : {}) }),
				),
			);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}

	stock(row: AdminVariantChoice, list: AdminVariantChoices): string {
		return stockWords({ stock: row.stock, soldBy: list.soldBy }, (key, params) =>
			this.transloco.translate(key, params),
		);
	}

	price(row: AdminVariantChoice): string {
		return money(row.price ?? 0, this.currency(), this.transloco.getActiveLang() === 'bn' ? 'bn-IN' : 'en-IN');
	}
}

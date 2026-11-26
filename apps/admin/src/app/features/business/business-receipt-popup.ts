import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { RupeesPipe, apiProblem, rupees, shortDate } from '@core/purchasing/purchasing-format';
import { indiaToday } from '@features/order/details/order-status-popup';
import { parseRupees } from '@features/purchasing/shared/payment-popup';

import type { Business, BusinessOpenOrder, BusinessReceiptWrite } from '@saha-textile/contracts';

/** One row of the Settles table: an open order and this receipt's share of it, as typed. */
export interface ReceiptShare {
	order: BusinessOpenOrder;
	amount: string;
}

/** The oldest open orders first, each up to what it owes, until the receipt runs out (bz06). */
export function oldestFirst(orders: readonly BusinessOpenOrder[], amountINR: number): ReceiptShare[] {
	let left = Math.max(0, amountINR);
	return [...orders]
		.sort((a, b) => a.placedAt.localeCompare(b.placedAt))
		.map((order) => {
			const share = Math.round(Math.min(left, order.dueINR) * 100) / 100;
			left = Math.round((left - share) * 100) / 100;
			return { order, amount: share > 0 ? String(share) : '' };
		});
}

/**
 * Record a receipt on account (brief bz06): method, amount, reference and date, then the orders it
 * settles: filled oldest first, and the split can be changed when they paid a specific order. The
 * server checks the split again and gives the receipt its number.
 */
@Component({
	selector: 'app-business-receipt-popup',
	template: `
		<div class="modal-header">
			<h2 id="business_receipt_popup_title">
				{{ 'biz_record_receipt' | transloco }}
				@if (business(); as b) {
					· {{ b.tradeName || b.legalName }}
				}
			</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body theme-form theme-form-2">
			<div class="row g-3">
				<div class="col-md-6">
					<label
						class="form-label"
						for="receipt_method"
					>
						{{ 'ord_col_method' | transloco }}
					</label>
					<select
						class="form-select"
						id="receipt_method"
						(change)="method.set($any($event.target).value)"
					>
						@for (item of methods; track item) {
							<option
								[value]="item"
								[selected]="method() === item"
							>
								{{ 'biz_receipt_' + item | transloco }}
							</option>
						}
					</select>
				</div>
				<div class="col-md-6">
					<label
						class="form-label"
						for="receipt_amount"
					>
						{{ 'ord_col_amount' | transloco }}
					</label>
					<div class="input-group">
						<span class="input-group-text">₹</span>
						<input
							class="form-control"
							id="receipt_amount"
							inputmode="decimal"
							ngbAutofocus
							[value]="amount()"
							(input)="setAmount($any($event.target).value)"
						/>
					</div>
				</div>
				<div class="col-md-6">
					<label
						class="form-label"
						for="receipt_reference"
					>
						{{ 'biz_receipt_reference_' + method() | transloco }}
					</label>
					<input
						class="form-control"
						id="receipt_reference"
						maxlength="80"
						[value]="reference()"
						(input)="reference.set($any($event.target).value)"
					/>
				</div>
				<div class="col-md-6">
					<label
						class="form-label"
						for="receipt_on"
					>
						{{ 'ord_received_on' | transloco }}
					</label>
					<input
						class="form-control"
						id="receipt_on"
						type="date"
						[max]="today"
						[value]="receivedOn()"
						(input)="receivedOn.set($any($event.target).value)"
					/>
				</div>
			</div>
			@if (shares().length) {
				<label class="form-label mt-3">{{ 'biz_settles' | transloco }}</label>
				<div class="table-responsive datatable-wrapper border-table">
					<table class="all-package theme-table no-footer table">
						<thead>
							<tr>
								<th>{{ 'ord_col_order' | transloco }}</th>
								<th>{{ 'biz_col_due' | transloco }}</th>
								<th class="text-end">{{ 'biz_col_open' | transloco }}</th>
								<th class="text-end">{{ 'biz_col_this_receipt' | transloco }}</th>
							</tr>
						</thead>
						<tbody>
							@for (share of shares(); track share.order.orderId; let index = $index) {
								<tr>
									<td>{{ share.order.orderNumber }}</td>
									<td>{{ day(share.order.dueOn) }}</td>
									<td class="text-end text-nowrap">{{ share.order.dueINR | rupees }}</td>
									<td class="text-end">
										<input
											class="form-control form-control-sm text-end"
											inputmode="decimal"
											[attr.aria-label]="'biz_col_this_receipt' | transloco"
											[value]="share.amount"
											(input)="setShare(index, $any($event.target).value)"
										/>
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<p class="small text-muted mb-0">{{ 'biz_settles_help' | transloco }}</p>
			} @else if (loaded()) {
				<p class="small text-muted mt-3 mb-0">{{ 'biz_settles_none' | transloco }}</p>
			}
			@if (error(); as problem) {
				<div
					class="alert alert-warning d-flex align-items-start mt-3 mb-0 gap-2"
					role="alert"
				>
					<i class="ri-error-warning-line mt-1"></i>
					<div>{{ problem }}</div>
				</div>
			}
		</div>
		<div class="modal-footer">
			<div class="left-part"></div>
			<div class="right-part d-flex gap-2">
				<button
					type="button"
					class="btn btn-outline"
					(click)="modal.dismiss()"
				>
					{{ 'cancel' | transloco }}
				</button>
				<button
					type="button"
					class="btn btn-theme"
					[disabled]="!canSave()"
					(click)="save()"
				>
					{{ 'ord_record_amount' | transloco: { amount: amountWords() } }}
				</button>
			</div>
		</div>
	`,
	imports: [RupeesPipe, TranslocoModule],
})
export class BusinessReceiptPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(BusinessesGateway);
	private readonly transloco = inject(TranslocoService);

	readonly methods: ReadonlyArray<BusinessReceiptWrite['method']> = ['bankTransfer', 'upi', 'cheque', 'cash'];
	readonly business = signal<Business | null>(null);
	readonly method = signal<BusinessReceiptWrite['method']>('bankTransfer');
	readonly amount = signal('');
	readonly reference = signal('');
	readonly receivedOn = signal(indiaToday());
	readonly openOrders = signal<BusinessOpenOrder[]>([]);
	readonly shares = signal<ReceiptShare[]>([]);
	/** Once staff change a share by hand, a new amount no longer refills the split. */
	readonly splitEdited = signal(false);
	readonly loaded = signal(false);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly today = indiaToday();
	readonly amountValue = computed(() => parseRupees(this.amount()));
	readonly amountWords = computed(() => rupees(this.amountValue() ?? 0));
	/** The split as numbers; a share that isn't a number makes the receipt unsaveable. */
	readonly allocations = computed(() =>
		this.shares().map((share) => ({
			orderId: share.order.orderId,
			value: share.amount.trim() ? parseRupees(share.amount) : 0,
			due: share.order.dueINR,
		})),
	);
	readonly splitProblem = computed(() => {
		const total = this.amountValue() ?? 0;
		const rows = this.allocations();
		if (rows.some((row) => row.value === null || row.value > row.due + 0.005)) return true;
		// Every share is a number here: a share that isn't returned above.
		return rows.reduce((sum, row) => sum + (row.value as number), 0) > total + 0.005;
	});

	async start(business: Business): Promise<void> {
		this.business.set(business);
		try {
			this.openOrders.set(await firstValueFrom(this.gateway.openOrders(business.id)));
			this.shares.set(oldestFirst(this.openOrders(), this.amountValue() ?? 0));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.loaded.set(true);
		}
	}

	setAmount(value: string): void {
		this.amount.set(value);
		if (!this.splitEdited()) this.shares.set(oldestFirst(this.openOrders(), this.amountValue() ?? 0));
	}

	setShare(index: number, value: string): void {
		this.splitEdited.set(true);
		this.shares.update((rows) => rows.map((row, at) => (at === index ? { ...row, amount: value } : row)));
	}

	day(value: string | null): string {
		return value ? shortDate(value) : '—';
	}

	canSave(): boolean {
		const value = this.amountValue();
		return (
			!this.busy() &&
			value !== null &&
			value > 0 &&
			!!this.reference().trim() &&
			!!this.receivedOn() &&
			!this.splitProblem()
		);
	}

	async save(): Promise<void> {
		const business = this.business();
		const value = this.amountValue();
		if (!business || value === null || !this.canSave()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const saved = await firstValueFrom(
				this.gateway.recordReceipt(business.id, {
					method: this.method(),
					amountINR: value,
					reference: this.reference().trim(),
					receivedOn: this.receivedOn(),
					note: null,
					allocations: this.allocations()
						// canSave() holds, so every share is a number.
						.filter((row) => (row.value as number) > 0)
						.map((row) => ({ orderId: row.orderId, amountINR: row.value as number })),
				}),
			);
			this.modal.close(saved ?? true);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}

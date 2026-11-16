import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { StockQuantityPipe } from '@core/purchasing/purchasing-format';

import type { ReturnableLine } from '@saha-textile/contracts';

/** "Only 3 can go back" (r03): which pieces are held or in paid orders, and the smaller number offered. */
@Component({
	selector: 'app-cap-popup',
	template: `
		@if (line(); as row) {
			<div class="modal-body">
				<i class="ri-error-warning-line icon-box"></i>
				<h5
					class="modal-title"
					id="cap_popup_title"
				>
					{{ 'pr_only_n_can_go_back' | transloco: { qty: (row.freeToReturn | stockQty: row.soldBy) } }}
				</h5>
				<p>
					{{
						'pr_cap_body'
							| transloco
								: {
										sku: row.sku,
										onHand: (row.onHand | stockQty: row.soldBy),
										held: (row.held | stockQty: row.soldBy),
										inOrders: (row.inOrders | stockQty: row.soldBy),
										free: (row.freeToReturn | stockQty: row.soldBy),
								  }
					}}
				</p>
				@if (row.capReason) {
					<p class="small text-muted">{{ row.capReason }}</p>
				}
				<p class="small text-muted">{{ 'pr_cap_help' | transloco }}</p>
				<div class="button-box">
					<button
						type="button"
						class="btn-md fw-bold btn btn-secondary"
						(click)="modal.dismiss()"
					>
						{{ 'change_quantity' | transloco }}
					</button>
					@if (row.freeToReturn > 0) {
						<button
							type="button"
							class="btn-theme btn-md fw-bold btn"
							(click)="modal.close('take')"
						>
							{{ 'pr_return_n' | transloco: { qty: (row.freeToReturn | stockQty: row.soldBy) } }}
						</button>
					}
				</div>
			</div>
		}
	`,
	imports: [StockQuantityPipe, TranslocoModule],
})
export class CapPopup {
	readonly modal = inject(NgbActiveModal);
	readonly line = signal<ReturnableLine | null>(null);

	start(line: ReturnableLine): void {
		this.line.set(line);
	}
}

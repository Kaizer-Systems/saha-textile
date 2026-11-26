import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, apiProblem, requestKey } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';

import type { PurchaseReturn } from '@saha-textile/contracts';

/**
 * Send to supplier (r04): the debit note gets its number, goods leave stock (a short-supply claim
 * moves none) and a delivery challan number is given when goods travel. One request key per popup.
 */
@Component({
	selector: 'app-return-send',
	template: `
		@if (doc(); as current) {
			<div class="modal-header">
				<h2 id="return_send_title">{{ 'pr_send_title' | transloco: { supplier: current.supplierName } }}</h2>
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
				<p>
					{{ (current.kind === 'short_supply' ? 'pr_send_claim_body' : 'pr_send_goods_body') | transloco }}
					<strong>{{ current.totalINR | rupees }}</strong>
				</p>
				@if (current.kind === 'return_goods') {
					<div class="row align-items-center g-2 mb-4">
						<label
							class="form-label-title col-sm-3 mb-0"
							for="return_courier"
						>
							{{ 'courier' | transloco }}
						</label>
						<div class="col-sm-9">
							<input
								class="form-control"
								id="return_courier"
								maxlength="80"
								[ngModel]="courier()"
								(ngModelChange)="courier.set($event)"
							/>
						</div>
					</div>
					<div class="row align-items-center g-2 mb-2">
						<label
							class="form-label-title col-sm-3 mb-0"
							for="return_docket"
						>
							{{ 'docket_no' | transloco }}
						</label>
						<div class="col-sm-9">
							<input
								class="form-control"
								id="return_docket"
								maxlength="80"
								[ngModel]="docket()"
								(ngModelChange)="docket.set($event)"
							/>
						</div>
					</div>
				}
				@if (error(); as problem) {
					<div
						class="alert alert-warning mt-3 mb-0"
						role="alert"
					>
						{{ problem }}
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
						id="return_send_confirm"
						[disabled]="busy()"
						(click)="send()"
					>
						{{ 'send_to_supplier' | transloco }}
					</button>
				</div>
			</div>
		}
	`,
	imports: [FormsModule, RupeesPipe, TranslocoModule],
})
export class ReturnSend {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly transloco = inject(TranslocoService);

	readonly doc = signal<PurchaseReturn | null>(null);
	readonly courier = signal('');
	readonly docket = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	private readonly key = requestKey('return-send');

	start(doc: PurchaseReturn): void {
		this.doc.set(doc);
	}

	async send(): Promise<void> {
		const doc = this.doc();
		if (!doc || this.busy()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const sent = await firstValueFrom(
				this.gateway.sendReturn(doc.id, {
					courier: this.courier().trim() || null,
					docket: this.docket().trim() || null,
					requestKey: this.key,
				}),
			);
			this.modal.close(sent);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import type { DocumentKind } from '@saha-textile/contracts';

/** The documents as the pop-up groups them (F04): two columns, Sales and Purchases left, the rest right. */
const COLUMNS: ReadonlyArray<ReadonlyArray<{ group: string; docs: readonly DocumentKind[] }>> = [
	[
		{
			group: 'sales',
			docs: ['taxInvoice', 'creditNote', 'debitNote', 'receipt', 'refundVoucher', 'deliveryChallan'],
		},
		{
			group: 'purchases',
			docs: ['purchaseOrder', 'purchaseEntry', 'purchaseReturnNote', 'selfInvoice', 'paymentVoucher'],
		},
	],
	[
		{ group: 'parcels', docs: ['packingSlip', 'returnNote'] },
		{ group: 'stock', docs: ['stockAdjustment', 'stockCount', 'openingStock', 'journal'] },
	],
];

/**
 * Make new layout: which document? (bundle builder brief F04, approved 2026-11-22). The builder that opens offers
 * only what that document can show; it starts from our format or from blank.
 */
@Component({
	selector: 'app-make-layout-popup',
	imports: [FormsModule, TranslocoModule],
	template: `
		<div class="modal-header">
			<h2 id="docf_make_title">{{ 'docf_make_title' | transloco }}</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body text-start">
			<p class="text-muted">{{ 'docf_make_body' | transloco }}</p>
			<div class="row g-3">
				@for (column of columns; track $index) {
					<div class="col-sm-6">
						@for (part of column; track part.group) {
							<h6 class="text-uppercase text-muted small mt-2 mb-1">
								{{ 'docf_group_' + part.group | transloco }}
							</h6>
							@for (kind of part.docs; track kind) {
								<div class="form-check">
									<input
										class="form-check-input"
										type="radio"
										name="docf_doc"
										[id]="'docf_pick_' + kind"
										[checked]="doc() === kind"
										(change)="doc.set(kind)"
									/>
									<label
										class="form-check-label"
										[for]="'docf_pick_' + kind"
									>
										{{ 'docf_doc_' + kind | transloco }}
									</label>
								</div>
							}
						}
					</div>
				}
			</div>
			<div class="d-flex align-items-center mt-3 flex-wrap gap-3">
				<strong>{{ 'docf_start_from' | transloco }}</strong>
				<div class="form-check form-check-inline mb-0">
					<input
						class="form-check-input"
						type="radio"
						name="docf_from"
						id="docf_from_ours"
						[checked]="from() === 'ours'"
						(change)="from.set('ours')"
					/>
					<label
						class="form-check-label"
						for="docf_from_ours"
					>
						{{ 'docf_from_ours' | transloco }}
					</label>
				</div>
				<div class="form-check form-check-inline mb-0">
					<input
						class="form-check-input"
						type="radio"
						name="docf_from"
						id="docf_from_blank"
						[checked]="from() === 'blank'"
						(change)="from.set('blank')"
					/>
					<label
						class="form-check-label"
						for="docf_from_blank"
					>
						{{ 'docf_from_blank' | transloco }}
					</label>
				</div>
			</div>
			<div class="mt-3">
				<label
					class="form-label"
					for="docf_new_name"
				>
					{{ 'docf_layout_name' | transloco }}
				</label>
				<input
					class="form-control"
					id="docf_new_name"
					maxlength="60"
					[ngModel]="name()"
					(ngModelChange)="name.set($event)"
				/>
			</div>
		</div>
		<div class="modal-footer">
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
				id="docf_make_continue"
				[disabled]="!ready()"
				(click)="modal.close({ doc: doc(), from: from(), name: name().trim() })"
			>
				{{ 'docf_continue' | transloco: { doc: ('docf_doc_' + doc() | transloco).toLowerCase() } }}
			</button>
		</div>
	`,
})
export class MakeLayoutPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);

	readonly columns = COLUMNS;
	readonly doc = signal<DocumentKind>('taxInvoice');
	readonly from = signal<'ours' | 'blank'>('ours');
	readonly name = signal(this.transloco.translate('docf_new_layout'));
	readonly ready = computed(() => this.name().trim().length > 0);
}

import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** Brief 7c: leaving the form with work that is saved nowhere. */
export type LeaveChoice = 'leave' | 'stay' | 'draft';

@Component({
	selector: 'app-product-leave-popup',
	template: `
		<div class="modal-header">
			<h2 id="product_leave_title">{{ 'draft_leave_title' | transloco }}</h2>
			<button
				type="button"
				class="btn btn-close"
				[title]="'close' | transloco"
				(click)="modal.close('stay')"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body">
			<p>{{ 'draft_leave_body' | transloco }}</p>
			@if (name()) {
				<p class="help-text mb-0">{{ name() }}</p>
			}
		</div>
		<div class="modal-footer">
			<div class="left-part"></div>
			<div class="right-part d-flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-outline"
					id="product_leave_discard"
					(click)="modal.close('leave')"
				>
					{{ 'draft_leave_without' | transloco }}
				</button>
				<button
					type="button"
					class="btn btn-outline"
					(click)="modal.close('stay')"
				>
					{{ 'draft_stay' | transloco }}
				</button>
				<button
					type="button"
					class="btn btn-theme"
					id="product_leave_draft"
					ngbAutofocus
					(click)="modal.close('draft')"
				>
					{{ 'draft_save_and_go' | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class ProductLeavePopup {
	readonly modal = inject(NgbActiveModal);
	readonly name = signal('');
}

/** One field both you and someone else changed after your draft began. */
export interface DraftConflict {
	path: string;
	/** The field's name in words, and the tab it is on. */
	label: string;
	theirs: string;
	mine: string;
}

/**
 * Brief 7g: Update Product when the product was saved by someone after the draft began. Asked only for
 * the fields both changed; the rest of the draft goes in as it is, and every check still runs after.
 */
@Component({
	selector: 'app-product-conflict-popup',
	template: `
		<div class="modal-header">
			<h2 id="product_conflict_title">{{ 'draft_conflict_title' | transloco }}</h2>
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
			<p>{{ 'draft_conflict_body' | transloco }}</p>
			<div class="table-responsive">
				<table class="mb-0 table align-middle">
					<thead>
						<tr>
							<th>{{ 'draft_field' | transloco }}</th>
							<th>{{ 'draft_in_product' | transloco }}</th>
							<th>{{ 'draft_in_draft' | transloco }}</th>
							<th>{{ 'draft_keep' | transloco }}</th>
						</tr>
					</thead>
					<tbody>
						@for (row of conflicts(); track row.path) {
							<tr>
								<td>
									<strong>{{ row.label }}</strong>
								</td>
								<td>{{ row.theirs }}</td>
								<td>{{ row.mine }}</td>
								<td>
									<div
										class="btn-group btn-group-sm"
										role="group"
									>
										<button
											type="button"
											class="btn"
											[class.btn-theme]="choice()[row.path] !== 'theirs'"
											[class.btn-outline]="choice()[row.path] === 'theirs'"
											(click)="pick(row.path, 'mine')"
										>
											{{ 'draft_mine' | transloco }}
										</button>
										<button
											type="button"
											class="btn"
											[class.btn-theme]="choice()[row.path] === 'theirs'"
											[class.btn-outline]="choice()[row.path] !== 'theirs'"
											(click)="pick(row.path, 'theirs')"
										>
											{{ 'draft_theirs' | transloco }}
										</button>
									</div>
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</div>
		<div class="modal-footer">
			<div class="left-part"></div>
			<div class="right-part d-flex gap-2">
				<button
					type="button"
					class="btn btn-outline"
					(click)="modal.dismiss()"
				>
					{{ 'draft_back_to_form' | transloco }}
				</button>
				<button
					type="button"
					class="btn btn-theme"
					id="product_conflict_confirm"
					(click)="modal.close(choice())"
				>
					{{ 'draft_update_with_choices' | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class ProductConflictPopup {
	readonly modal = inject(NgbActiveModal);
	readonly conflicts = signal<DraftConflict[]>([]);
	readonly choice = signal<Record<string, 'mine' | 'theirs'>>({});

	pick(path: string, side: 'mine' | 'theirs'): void {
		this.choice.update((choice) => ({ ...choice, [path]: side }));
	}
}

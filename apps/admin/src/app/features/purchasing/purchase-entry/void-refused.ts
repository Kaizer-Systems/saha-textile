import { Component, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import type { ApiIssue } from '@core/purchasing/purchasing-format';

/**
 * "This entry can't be voided" (p12): pieces from it have sold, are in a paid checkout, or went
 * back. It names them and offers the right tool instead, a purchase return. Closes with 'return'
 * when that is chosen.
 */
@Component({
	selector: 'app-void-refused',
	template: `
		<div class="modal-body">
			<i class="ri-forbid-line icon-box"></i>
			<h5
				class="modal-title"
				id="void_refused_title"
			>
				{{ 'void_refused_title' | transloco }}
			</h5>
			<p>{{ 'void_refused_body' | transloco }}</p>
			<div
				class="mx-auto text-start"
				style="max-width: 520px"
			>
				<table class="table-sm mb-3 table">
					<tbody>
						@for (row of rows(); track row.target) {
							<tr>
								<td class="text-muted">{{ row.target }}</td>
								<td class="text-end">{{ row.message }}</td>
							</tr>
						}
					</tbody>
				</table>
				<p class="small text-muted">{{ 'void_refused_help' | transloco }}</p>
			</div>
			<div class="button-box">
				<button
					type="button"
					class="btn-md fw-bold btn btn-secondary"
					(click)="modal.dismiss()"
				>
					{{ 'close' | transloco }}
				</button>
				<button
					type="button"
					class="btn-theme btn-md fw-bold btn"
					(click)="modal.close('return')"
				>
					{{ 'make_a_purchase_return' | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class VoidRefused {
	readonly modal = inject(NgbActiveModal);
	readonly rows = signal<ApiIssue[]>([]);

	start(issues: readonly ApiIssue[]): void {
		this.rows.set([...issues]);
	}
}

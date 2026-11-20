import { Component, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { MIN_REASON } from '@features/purchasing/shared/reason-popup';

import type { Business, BusinessStanding } from '@saha-textile/contracts';

/**
 * Change standing (bz05): Active · Credit on hold (orders only when paid) · Blocked (no new orders).
 * A reason is required and kept with the name and time.
 */
@Component({
	selector: 'app-business-standing-popup',
	template: `
		<div class="modal-header">
			<h2 id="business_standing_popup_title">
				{{ 'biz_change_standing_for' | transloco: { name: business()?.tradeName || business()?.legalName } }}
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
			<div class="d-grid mb-3 gap-2">
				@for (item of choices; track item) {
					<div
						class="rounded border p-2"
						[class.is-chosen]="standing() === item"
					>
						<div class="form-check">
							<input
								class="form-check-input"
								type="radio"
								name="business_standing"
								[id]="'standing_' + item"
								[checked]="standing() === item"
								(change)="standing.set(item)"
							/>
							<label
								class="form-check-label"
								[for]="'standing_' + item"
							>
								<b>{{ 'ord_standing_' + item | transloco }}</b>
								<span class="d-block small text-muted">
									{{ 'biz_standing_' + item + '_help' | transloco }}
								</span>
							</label>
						</div>
					</div>
				}
			</div>
			<label
				class="form-label"
				for="standing_reason"
			>
				{{ 'biz_reason' | transloco }}
			</label>
			<textarea
				class="form-control"
				id="standing_reason"
				rows="2"
				maxlength="500"
				[value]="reason()"
				(input)="reason.set($any($event.target).value)"
			></textarea>
			<p class="small text-muted mt-3 mb-0">{{ 'biz_standing_recorded_note' | transloco }}</p>
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
					{{ 'biz_standing_button_' + standing() | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [TranslocoModule],
})
export class BusinessStandingPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(BusinessesGateway);
	private readonly transloco = inject(TranslocoService);

	readonly choices: readonly BusinessStanding[] = ['active', 'creditOnHold', 'blocked'];
	readonly business = signal<Business | null>(null);
	readonly standing = signal<BusinessStanding>('active');
	readonly reason = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	start(business: Business): void {
		this.business.set(business);
		this.standing.set(business.roles.customer?.standing ?? 'active');
	}

	canSave(): boolean {
		const current = this.business()?.roles.customer?.standing ?? 'active';
		return !this.busy() && this.standing() !== current && this.reason().trim().length >= MIN_REASON;
	}

	async save(): Promise<void> {
		const business = this.business();
		if (!business || !this.canSave()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const saved = await firstValueFrom(
				this.gateway.setStanding(business.id, { standing: this.standing(), reason: this.reason().trim() }),
			);
			this.modal.close(saved);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}

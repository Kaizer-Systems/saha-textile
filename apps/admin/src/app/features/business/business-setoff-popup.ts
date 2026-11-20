import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { BusinessesGateway } from '@core/business/businesses.gateway';
import { RupeesPipe, apiProblem, rupees, shortDate } from '@core/purchasing/purchasing-format';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { indiaToday } from '@features/order/details/order-status-popup';
import { parseRupees } from '@features/purchasing/shared/payment-popup';

import type { Business, SetOffWrite } from '@saha-textile/contracts';

/** A standing agreement that covers today, or null (then a one-off entry needs its own signed copy). */
export function standingAgreement(business: Business, today: string) {
	const setting = business.setOff;
	if (setting.mode !== 'agreement') return null;
	if (setting.signedOn > today || (setting.validUntil && setting.validUntil < today)) return null;
	return setting;
}

/**
 * Record a set-off (brief so02, so03; owner message 18: kept ready for other businesses, and off for
 * Saha Textile): at most the smaller of the two balances, one journal entry shown in both accounts. Under
 * the business's standing written agreement, or as a one-off with its own signed copy. The server
 * checks the agreement and the balances again.
 */
@Component({
	selector: 'app-business-setoff-popup',
	template: `
		<div class="modal-header">
			<h2 id="business_setoff_popup_title">
				{{ 'biz_record_setoff' | transloco }}
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
			<div class="row g-3 mb-3">
				<div class="col-md-6">
					<ul class="list-unstyled small mb-0">
						<li class="d-flex justify-content-between border-bottom py-1">
							<span class="text-muted">{{ 'biz_they_owe_us' | transloco }}</span>
							<span>{{ theyOweUs() | rupees }}</span>
						</li>
						<li class="d-flex justify-content-between py-1">
							<span class="text-muted">{{ 'biz_we_owe_them' | transloco }}</span>
							<span>{{ weOweThem() | rupees }}</span>
						</li>
					</ul>
				</div>
				<div class="col-md-6">
					<div
						class="alert alert-info d-flex align-items-start mb-0 gap-2"
						role="status"
					>
						<i class="ri-scales-3-line mt-1"></i>
						<div>{{ 'biz_setoff_at_most' | transloco: { amount: (limit() | rupees) } }}</div>
					</div>
				</div>
			</div>
			<div class="row g-3">
				<div class="col-md-6">
					<label
						class="form-label"
						for="setoff_amount"
					>
						{{ 'ord_col_amount' | transloco }}
					</label>
					<div class="input-group">
						<span class="input-group-text">₹</span>
						<input
							class="form-control"
							id="setoff_amount"
							inputmode="decimal"
							ngbAutofocus
							[value]="amount()"
							(input)="amount.set($any($event.target).value)"
						/>
					</div>
				</div>
				<div class="col-md-6">
					<label
						class="form-label"
						for="setoff_on"
					>
						{{ 'biz_col_date' | transloco }}
					</label>
					<input
						class="form-control"
						id="setoff_on"
						type="date"
						[max]="today"
						[value]="on()"
						(input)="on.set($any($event.target).value)"
					/>
				</div>
				@if (agreement(); as standing) {
					<div class="col-12">
						<label
							class="form-label"
							for="setoff_agreement"
						>
							{{ 'biz_setoff_agreement' | transloco }}
						</label>
						<input
							class="form-control"
							id="setoff_agreement"
							readonly
							[value]="agreementLine()"
						/>
					</div>
				} @else {
					<div class="col-12">
						<label
							class="form-label"
							for="setoff_letter"
						>
							{{ 'biz_setoff_one_off' | transloco }}
						</label>
						<div class="d-flex align-items-center flex-wrap gap-2">
							@if (signedCopy(); as file) {
								<span class="fm-chip">
									<i class="ri-file-pdf-2-line"></i>
									{{ file.name }}
								</span>
							}
							<a
								class="small fw-bold"
								href="javascript:void(0)"
								(click)="pickCopy()"
							>
								{{ (signedCopy() ? 'biz_replace' : 'biz_choose_signed_copy') | transloco }}
							</a>
							<input
								class="form-control flex-grow-1"
								id="setoff_letter"
								maxlength="80"
								[placeholder]="'biz_setoff_letter_placeholder' | transloco"
								[value]="letter()"
								(input)="letter.set($any($event.target).value)"
							/>
						</div>
						<p class="help-text mb-0">{{ 'biz_setoff_one_off_help' | transloco }}</p>
					</div>
				}
				<div class="col-12">
					<label
						class="form-label"
						for="setoff_note"
					>
						{{ 'ord_note' | transloco }}
					</label>
					<input
						class="form-control"
						id="setoff_note"
						maxlength="500"
						[placeholder]="'biz_setoff_note_placeholder' | transloco"
						[value]="note()"
						(input)="note.set($any($event.target).value)"
					/>
				</div>
			</div>
			<ul class="list-unstyled small mb-0 mt-3">
				<li class="mb-1">
					<span class="text-muted">{{ 'biz_setoff_entry' | transloco }}:</span>
					{{ 'biz_setoff_entry_line' | transloco }}
				</li>
				<li class="mb-1">
					<span class="text-muted">{{ 'biz_setoff_result' | transloco }}:</span>
					{{ 'biz_setoff_result_line' | transloco: { us: (afterUs() | rupees), them: (afterThem() | rupees) } }}
				</li>
				<li class="mb-1">
					<span class="text-muted">GST:</span>
					{{ 'biz_setoff_gst_note' | transloco }}
				</li>
			</ul>
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
					{{ 'biz_record_setoff_button' | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [RupeesPipe, TranslocoModule],
})
export class BusinessSetOffPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(BusinessesGateway);
	private readonly transloco = inject(TranslocoService);

	readonly business = signal<Business | null>(null);
	readonly theyOweUs = signal(0);
	readonly weOweThem = signal(0);
	readonly amount = signal('');
	readonly today = indiaToday();
	readonly on = signal(indiaToday());
	readonly letter = signal('');
	readonly note = signal('');
	readonly signedCopy = signal<{ assetId: string; name: string } | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	readonly limit = computed(() => Math.max(0, Math.min(this.theyOweUs(), this.weOweThem())));
	readonly agreement = computed(() => {
		const business = this.business();
		return business ? standingAgreement(business, this.on() || this.today) : null;
	});
	readonly agreementLine = computed(() => {
		const standing = this.agreement();
		if (!standing) return '';
		return standing.validUntil
			? this.transloco.translate('biz_setoff_agreement_line', {
					reference: standing.reference,
					until: shortDate(standing.validUntil),
				})
			: standing.reference;
	});
	readonly amountValue = computed(() => parseRupees(this.amount()));
	readonly afterUs = computed(() => Math.max(0, this.theyOweUs() - (this.amountValue() ?? 0)));
	readonly afterThem = computed(() => Math.max(0, this.weOweThem() - (this.amountValue() ?? 0)));

	start(business: Business, balances: { theyOweUsINR: number; weOweThemINR: number }): void {
		this.business.set(business);
		this.theyOweUs.set(Math.max(0, balances.theyOweUsINR));
		this.weOweThem.set(Math.max(0, balances.weOweThemINR));
		this.amount.set(String(this.limit()));
	}

	canSave(): boolean {
		const value = this.amountValue();
		if (this.busy() || value === null || value <= 0 || value > this.limit() + 0.005) return false;
		if (this.note().trim().length < 3 || !this.on()) return false;
		return !!this.agreement() || (!!this.signedCopy() && !!this.letter().trim());
	}

	/** The signed copy for a one-off entry, from Media (the file manager's own picker). */
	async pickCopy(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'biz_choose_signed_copy',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) this.signedCopy.set({ assetId: picked[0].assetId, name: picked[0].name });
	}

	async save(): Promise<void> {
		const business = this.business();
		const value = this.amountValue();
		if (!business || value === null || !this.canSave()) return;
		const copy = this.signedCopy();
		const basis: SetOffWrite['basis'] = this.agreement()
			? { kind: 'standingAgreement' }
			: { kind: 'oneOff', reference: this.letter().trim(), signedOn: this.on(), mediaId: copy?.assetId ?? '' };
		this.busy.set(true);
		this.error.set(null);
		try {
			await firstValueFrom(
				this.gateway.recordSetOff(business.id, { amountINR: value, basis, note: this.note().trim(), on: this.on() }),
			);
			this.modal.close(true);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('ord_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}

	money(amount: number): string {
		return rupees(amount);
	}
}

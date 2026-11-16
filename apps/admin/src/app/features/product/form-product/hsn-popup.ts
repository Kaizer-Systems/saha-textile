import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/** What changed when the main category moved (F02). */
export interface HsnChange {
	category: string;
	oldCategory: string | null;
	oldHsn: string | null;
	newHsn: string;
	/** "Can be returned" from the new category, and what the product had before (P13). */
	returnableNow: boolean;
	returnableBefore: boolean;
}

/** An HSN has 4, 6 or 8 digits (F02C); the server checks the same on save. */
export function hsnValid(code: string): boolean {
	return /^(\d{4}|\d{6}|\d{8})$/.test(code.trim());
}

/**
 * F02 / F02B / F02C: the main category changed, so the HSN field now shows the new category's
 * code. Put back the old code, keep the new one, or type one: the box takes Enter for the green
 * tick and Esc for the red cross. Closes with the code to use; nothing is saved until Save.
 */
@Component({
	selector: 'app-hsn-popup',
	template: `
		@if (change(); as current) {
			<div class="modal-body">
				<i class="ri-error-warning-line icon-box"></i>
				<h5
					class="modal-title"
					id="hsn_popup_title"
				>
					{{ 'hsn_popup_title' | transloco }}
				</h5>
				<p>
					{{
						(current.oldHsn ? 'hsn_popup_body' : 'hsn_popup_body_new')
							| transloco
								: {
										category: current.category,
										code: current.newHsn,
										old: current.oldHsn ?? '',
										oldCategory: current.oldCategory ?? '—',
								  }
					}}
				</p>
				<p class="small text-muted">
					{{
						'hsn_popup_returnable'
							| transloco
								: {
										category: current.category,
										now: (current.returnableNow ? 'yes' : 'no') | transloco,
										before: (current.returnableBefore ? 'yes' : 'no') | transloco,
								  }
					}}
				</p>
				@if (manual()) {
					<div
						class="mx-auto text-start"
						style="max-width: 360px"
					>
						<label
							class="form-label-title mb-1"
							for="hsn_manual"
						>
							{{ 'hsn_code' | transloco }}
						</label>
						<div class="d-flex align-items-start gap-2">
							<div class="flex-grow-1">
								<input
									#box
									id="hsn_manual"
									class="form-control"
									inputmode="numeric"
									maxlength="8"
									[class.is-invalid]="typed().length > 0 && !valid()"
									[ngModel]="typed()"
									(ngModelChange)="typed.set($event)"
									(keydown.enter)="$event.preventDefault(); use()"
									(keydown.escape)="$event.preventDefault(); $event.stopPropagation(); back()"
								/>
								@if (typed().length > 0 && !valid()) {
									<div class="invalid-feedback d-block">{{ 'hsn_digits' | transloco }}</div>
								} @else {
									<p class="help-text">{{ 'hsn_manual_help' | transloco }}</p>
								}
							</div>
							<a
								href="javascript:void(0)"
								id="hsn_manual_use"
								class="text-success fs-2 lh-1"
								[class.opacity-50]="!valid()"
								[class.pe-none]="!valid()"
								[attr.aria-disabled]="!valid()"
								[title]="'hsn_use_this_code' | transloco"
								[attr.aria-label]="'hsn_use_this_code' | transloco"
								(click)="use()"
							>
								<i class="ri-checkbox-circle-fill"></i>
							</a>
							<a
								href="javascript:void(0)"
								id="hsn_manual_cancel"
								class="text-danger fs-2 lh-1"
								[title]="'hsn_cancel_go_back' | transloco"
								[attr.aria-label]="'hsn_cancel_go_back' | transloco"
								(click)="back()"
							>
								<i class="ri-close-circle-fill"></i>
							</a>
						</div>
					</div>
				} @else {
					<div class="button-box">
						@if (current.oldHsn) {
							<button
								type="button"
								class="btn-md fw-bold btn btn-secondary"
								id="hsn_put_back"
								(click)="modal.close(current.oldHsn)"
							>
								{{ 'hsn_put_back' | transloco: { code: current.oldHsn } }}
							</button>
						}
						<button
							type="button"
							class="btn-md fw-bold btn btn-outline"
							id="hsn_enter_manually"
							(click)="openManual()"
						>
							{{ 'hsn_enter_manually' | transloco }}
						</button>
						<button
							type="button"
							class="btn-md fw-bold btn btn-theme"
							id="hsn_keep"
							(click)="modal.close(current.newHsn)"
						>
							{{ 'hsn_keep' | transloco: { code: current.newHsn } }}
						</button>
					</div>
				}
			</div>
		}
	`,
	imports: [FormsModule, TranslocoModule],
})
export class HsnPopup {
	readonly modal = inject(NgbActiveModal);
	readonly change = signal<HsnChange | null>(null);
	readonly manual = signal(false);
	readonly typed = signal('');
	readonly valid = computed(() => hsnValid(this.typed()));

	start(change: HsnChange): void {
		this.change.set(change);
	}

	openManual(): void {
		this.typed.set('');
		this.manual.set(true);
		setTimeout(() => document.getElementById('hsn_manual')?.focus());
	}

	/** Green tick (or Enter): the typed code goes into the HSN field. */
	use(): void {
		if (this.valid()) this.modal.close(this.typed().trim());
	}

	/** Red cross (or Esc): the box goes, the three buttons come back. */
	back(): void {
		this.manual.set(false);
		this.typed.set('');
	}
}

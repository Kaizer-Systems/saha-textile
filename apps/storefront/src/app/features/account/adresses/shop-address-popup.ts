import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { CheckoutGateway } from '@core/checkout/checkout.gateway';
import { AccountStore } from '@core/state/account.store';
import { ShopAddressForm } from '@shared/ui/shop-address-form/shop-address-form';

import type { PostalAddressInput } from '@saha-textile/contracts';

/**
 * Add or edit a saved address (orders brief shop15, shop16; DEC-ADDRESS): Name this address, then the
 * shop's address form with the country rules (the country picks the State list and the phone code),
 * and "Make this my default address". Saved through the checked address-book routes.
 */
@Component({
	selector: 'app-shop-address-popup',
	template: `
		<div class="modal-header">
			<h5 class="modal-title">{{ (addressId() ? 'adr_edit_address' : 'add_address') | transloco }}</h5>
			<button
				type="button"
				class="btn-close"
				[title]="'close' | transloco"
				(click)="modal.dismiss()"
			>
				<i class="ri-close-line"></i>
			</button>
		</div>
		<div class="modal-body address-form">
			<app-shop-address-form
				[idPrefix]="'shop_address'"
				[initial]="initial()"
				(changed)="address.set($event)"
			>
				<div
					class="col-md-6"
					addressFirst
				>
					<label
						class="form-label"
						for="shop_address_label"
					>
						{{ 'chk_name_this_address' | transloco }}
					</label>
					<input
						class="form-control"
						id="shop_address_label"
						maxlength="80"
						[value]="label()"
						(input)="label.set($any($event.target).value)"
					/>
					<p class="small text-muted mb-0">{{ 'adr_name_hint' | transloco }}</p>
				</div>
			</app-shop-address-form>
			<div class="form-check mt-3">
				<input
					class="form-check-input"
					type="checkbox"
					id="shop_address_default"
					[checked]="isDefault()"
					(change)="isDefault.set($any($event.target).checked)"
				/>
				<label
					class="form-check-label"
					for="shop_address_default"
				>
					{{ 'adr_make_default' | transloco }}
				</label>
			</div>
			@if (error()) {
				<p class="small text-danger mt-2 mb-0">{{ 'adr_not_saved' | transloco }}</p>
			}
		</div>
		<div class="modal-footer">
			<button
				type="button"
				class="btn btn-md btn-theme-outline fw-bold"
				(click)="modal.dismiss()"
			>
				{{ 'ret_close' | transloco }}
			</button>
			<button
				type="button"
				class="btn theme-bg-color btn-md fw-bold text-light"
				[disabled]="!ready() || busy()"
				(click)="save()"
			>
				{{ 'adr_save_address' | transloco }}
			</button>
		</div>
	`,
	imports: [ShopAddressForm, TranslocoModule],
})
export class ShopAddressPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(CheckoutGateway);
	private readonly account = inject(AccountStore);

	readonly addressId = signal<string | null>(null);
	readonly initial = signal<Record<string, unknown> | null>(null);
	readonly label = signal('');
	readonly isDefault = signal(false);
	readonly address = signal<PostalAddressInput | null>(null);
	readonly busy = signal(false);
	readonly error = signal(false);
	readonly ready = computed(() => !!this.address() && !!this.label().trim());

	start(row: { address_id?: string; title?: string; is_default?: boolean } | null, firstAddress: boolean): void {
		this.addressId.set(row?.address_id ?? null);
		this.label.set(row?.title ?? '');
		this.isDefault.set(row ? !!row.is_default : firstAddress);
	}

	async save(): Promise<void> {
		const address = this.address();
		if (!address || !this.ready()) return;
		this.busy.set(true);
		this.error.set(false);
		try {
			await firstValueFrom(
				this.gateway.saveAddress(this.addressId(), {
					...address,
					label: this.label().trim(),
					isDefault: this.isDefault(),
				}),
			);
			this.account.loadUser();
			this.modal.close(true);
		} catch {
			this.error.set(true);
		} finally {
			this.busy.set(false);
		}
	}
}

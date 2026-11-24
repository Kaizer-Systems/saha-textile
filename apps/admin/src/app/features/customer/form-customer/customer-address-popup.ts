import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { CustomerAddressBookGateway } from '@core/admin-customers/customer-address-book.gateway';
import { apiProblem } from '@core/purchasing/purchasing-format';
import { PostalAddressForm, type PostalAddressDraft } from '@shared/ui/postal-address-form/postal-address-form';

import type { Address, PostalAddressInput, SavedAddressWrite } from '@saha-textile/contracts';

/** A saved row as the customer page holds it; newer rows also carry the country-rule fields. */
export type CustomerAddressRow = {
	id: string;
	label?: string;
	fullName: string;
	line1: string;
	line2?: string;
	city: string;
	state?: string;
	postalCode: string;
	country: string;
	phone?: string;
	isDefault: boolean;
} & Partial<Pick<Address, 'countryCode' | 'subdivisionCode' | 'landmark' | 'mobile' | 'altMobile'>>;

const digits = (text: string | undefined): string => (text ?? '').replace(/\D/g, '');

/** A saved row back into the form's fields. Older rows hold one phone string and maybe a country name. */
export function draftFromRow(row: CustomerAddressRow): Partial<PostalAddressDraft> {
	const countryCode = row.countryCode ?? (/^[A-Z]{2}$/.test(row.country) ? row.country : 'IN');
	const callingCode = row.mobile?.countryCallingCode ?? (countryCode === 'IN' ? '91' : '');
	const oldPhone = digits(row.phone);
	return {
		fullName: row.fullName,
		countryCode,
		...(callingCode ? { callingCode } : {}),
		...(row.altMobile ? { altCallingCode: row.altMobile.countryCallingCode } : {}),
		mobile: row.mobile?.number ?? (oldPhone.length > 10 ? oldPhone.slice(-10) : oldPhone),
		altMobile: row.altMobile?.number ?? '',
		line1: row.line1,
		line2: row.line2 ?? '',
		landmark: row.landmark ?? '',
		postalCode: row.postalCode,
		city: row.city,
		subdivisionCode: row.subdivisionCode ?? '',
	};
}

/** One saved address as its card writes it (ad04, bz02): street, area, city, State and country. */
export function addressCardLine(row: CustomerAddressRow, lang: string): string {
	const code = row.countryCode ?? (/^[A-Z]{2}$/.test(row.country) ? row.country : null);
	let country = row.country;
	if (code) {
		try {
			// With the default fallback ('code'), of() answers a name or the code itself, never undefined.
			country = new Intl.DisplayNames([lang === 'bn' ? 'bn' : 'en'], { type: 'region' }).of(code) as string;
		} catch {
			country = row.country;
		}
	}
	return [row.line1, row.line2, row.landmark, row.city, row.state, country]
		.map((part) => (part ?? '').trim())
		.filter(Boolean)
		.join(', ');
}

/** What the country calls its postal code: PIN code in India, Postcode in the UK, ZIP code in the US. */
export function postalLabelKeyOf(row: Pick<CustomerAddressRow, 'country' | 'countryCode'>): string {
	const code = row.countryCode ?? row.country;
	return code === 'IN' || code === 'India'
		? 'addr_postal_pin'
		: code === 'GB'
			? 'addr_postal_postcode'
			: code === 'US'
				? 'addr_postal_zip'
				: 'addr_postal_postal';
}

export function phoneTextOf(row: Pick<CustomerAddressRow, 'mobile' | 'phone'>): string {
	return row.mobile ? `+${row.mobile.countryCallingCode} ${row.mobile.number}` : (row.phone ?? '');
}

/** The form's address plus its name and the default switch, as the address-book routes take it. */
export function toSavedAddress(address: PostalAddressInput, label: string, isDefault: boolean): SavedAddressWrite {
	return { ...address, label: label.trim(), isDefault };
}

/**
 * Admin › Customers › a customer's addresses (brief ad04–ad05; DEC-ADDRESS): "Add address · {name}"
 * with the shared address form, so the country rules are the shop's and the checkouts'. Saves through
 * the checked address-book routes when the customer exists; on a customer not saved yet it closes with
 * the address, which the page saves after the customer.
 */
@Component({
	selector: 'app-customer-address-popup',
	template: `
		<div class="modal-header">
			<h2 id="customer_address_popup_title">
				{{
					(editing() ? 'cust_edit_address_title' : 'cust_add_address_title')
						| transloco: { name: customerName() }
				}}
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
			<app-postal-address-form
				[idPrefix]="'cust_address'"
				[initial]="initial()"
				(changed)="address.set($event)"
			>
				<div
					class="col-md-6"
					addressFirst
				>
					<label
						class="form-label"
						for="cust_address_label"
					>
						{{ 'ord_name_this_address' | transloco }}
					</label>
					<input
						class="form-control"
						id="cust_address_label"
						maxlength="80"
						autocomplete="off"
						ngbAutofocus
						[value]="label()"
						(input)="label.set($any($event.target).value)"
					/>
					<p class="help-text mb-0">{{ 'ord_name_this_address_hint' | transloco }}</p>
				</div>
			</app-postal-address-form>
			<div class="form-check mt-3">
				<input
					class="form-check-input"
					type="checkbox"
					id="cust_address_default"
					[checked]="isDefault()"
					(change)="isDefault.set($any($event.target).checked)"
				/>
				<label
					class="form-check-label"
					for="cust_address_default"
				>
					{{ 'cust_use_as_default_delivery' | transloco }}
				</label>
			</div>
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
			<div class="right-part">
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
					[disabled]="!ready() || busy()"
					(click)="save()"
				>
					{{ 'cust_save_address' | transloco }}
				</button>
			</div>
		</div>
	`,
	imports: [PostalAddressForm, TranslocoModule],
})
export class CustomerAddressPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(CustomerAddressBookGateway);
	private readonly transloco = inject(TranslocoService);

	readonly customerId = signal<string | null>(null);
	readonly customerName = signal('');
	readonly addressId = signal<string | null>(null);
	readonly editing = computed(() => this.addressId() !== null);
	readonly initial = signal<Partial<PostalAddressDraft> | null>(null);
	readonly label = signal('');
	readonly isDefault = signal(false);
	readonly address = signal<PostalAddressInput | null>(null);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	readonly ready = computed(() => !!this.address() && !!this.label().trim());

	/** `customerId` null: the customer isn't saved yet, so the popup only hands the address back. */
	start(options: {
		customerId: string | null;
		customerName: string;
		row?: CustomerAddressRow;
		firstAddress?: boolean;
	}): void {
		this.customerId.set(options.customerId);
		this.customerName.set(options.customerName);
		const row = options.row;
		this.addressId.set(row && !row.id.startsWith('draft_') ? row.id : null);
		this.label.set(row?.label ?? '');
		this.isDefault.set(row ? row.isDefault : !!options.firstAddress);
		this.initial.set(row ? draftFromRow(row) : options.customerName ? { fullName: options.customerName } : null);
	}

	async save(): Promise<void> {
		const address = this.address();
		if (!address || !this.label().trim()) return;
		const body = toSavedAddress(address, this.label(), this.isDefault());
		const customerId = this.customerId();
		if (!customerId) {
			this.modal.close(body);
			return;
		}
		this.busy.set(true);
		this.error.set(null);
		try {
			await firstValueFrom(this.gateway.save(customerId, this.addressId(), body));
			this.modal.close(body);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('cust_address_not_saved')));
		} finally {
			this.busy.set(false);
		}
	}
}

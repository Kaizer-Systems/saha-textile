import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Select2, Select2Data, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { currencyDisplayName } from '@core/fx/fx.gateway';
import { OrderDraftStore, type DraftBuyer } from '@core/orders/order-draft.store';
import { OrdersGateway, injectOrderCurrenciesQuery } from '@core/orders/orders.gateway';
import { RupeesPipe } from '@core/purchasing/purchasing-format';
import { AddCustomerModal } from '@features/order/checkout/modal/add-customer-modal/add-customer-modal';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { BusinessBuyerOption, CustomerBuyerOption } from '@saha-textile/contracts';

/** The words a picked buyer shows in the picker (oc01, oc03). */
export function buyerLabel(buyer: DraftBuyer): string {
	if (buyer.kind === 'person') {
		const { customer } = buyer;
		return [customer.name, customer.email, customer.phone].filter((part) => !!part).join(' · ');
	}
	const { business } = buyer;
	const name =
		business.tradeName && business.tradeName !== business.legalName
			? `${business.tradeName} (${business.legalName})`
			: business.legalName;
	return [name, business.gstin ? `GSTIN ${business.gstin}` : null, business.phone]
		.filter((part) => !!part)
		.join(' · ');
}

/**
 * "Order for" on Create order (brief oc01–oc03; owner 2026-11-20): Shop customer or Business, found
 * with the admin's search select (select2) by name, phone or email, or a business by name, phone or
 * GSTIN, searched on the server as staff type; the currency, switchable at any time. A business
 * shows its credit, standing and the GSTIN its invoices go to.
 */
@Component({
	selector: 'app-order-buyer-card',
	templateUrl: './order-buyer-card.html',
	imports: [AddCustomerModal, HasPermissionDirective, RouterModule, RupeesPipe, Select2, TranslocoModule],
})
export class OrderBuyerCard {
	readonly draft = inject(OrderDraftStore);
	private readonly gateway = inject(OrdersGateway);
	private readonly transloco = inject(TranslocoService);

	readonly currencies = injectOrderCurrenciesQuery();
	readonly addCustomer = viewChild<AddCustomerModal>('addCustomerModal');

	private readonly found = signal<Array<CustomerBuyerOption | BusinessBuyerOption>>([]);
	private timer: ReturnType<typeof setTimeout> | null = null;
	private asked = 0;

	readonly business = computed(() => {
		const buyer = this.draft.buyer();
		return buyer?.kind === 'business' ? buyer.business : null;
	});
	/** The picker's rows: the current buyer first, so it stays shown, then what the search found. */
	readonly options = computed<Select2Data>(() => {
		const buyer = this.draft.buyer();
		const rows: Select2Data = [];
		if (buyer) rows.push({ value: this.idOf(buyer), label: buyerLabel(buyer) });
		for (const row of this.found()) {
			if (buyer && row.id === this.idOf(buyer)) continue;
			rows.push({ value: row.id, label: buyerLabel(this.asBuyer(row)) });
		}
		return rows;
	});
	readonly selected = computed(() => {
		const buyer = this.draft.buyer();
		return buyer ? this.idOf(buyer) : null;
	});
	readonly currencyRows = computed(() =>
		[...(this.currencies.data() ?? [])]
			.filter((row) => row.enabled)
			.sort((a, b) => (a.code === 'INR' ? -1 : b.code === 'INR' ? 1 : a.code.localeCompare(b.code))),
	);
	/** oc02: what a foreign-currency cart is priced at. */
	readonly rateNote = computed(() => {
		const code = this.draft.currency();
		const row = this.currencyRows().find((currency) => currency.code === code);
		if (!row || code === 'INR') return null;
		return { symbol: row.symbol, perUnit: Math.round((1 / row.rateFromINR) * 100) / 100 };
	});

	currencyName(code: string): string {
		return currencyDisplayName(code, this.transloco.getActiveLang(), (key) => this.transloco.translate(key));
	}

	setKind(kind: 'person' | 'business'): void {
		this.draft.setBuyerKind(kind);
		this.found.set([]);
	}

	search(event: Select2SearchEvent): void {
		const q = event.search.trim();
		if (this.timer) clearTimeout(this.timer);
		if (!q) {
			this.found.set([]);
			return;
		}
		this.timer = setTimeout(() => void this.lookUp(q), 300);
	}

	pick(event: Select2UpdateEvent): void {
		const id = event.value === null || event.value === undefined ? '' : String(event.value);
		if (!id) {
			this.draft.setBuyer(null);
			return;
		}
		const current = this.draft.buyer();
		if (current && this.idOf(current) === id) return;
		const row = this.found().find((option) => option.id === id);
		if (row) this.draft.setBuyer(this.asBuyer(row));
	}

	clear(): void {
		this.draft.setBuyer(null);
	}

	async newCustomer(): Promise<void> {
		await this.addCustomer()?.openModal();
	}

	private async lookUp(q: string): Promise<void> {
		const asked = ++this.asked;
		const kind = this.draft.buyerKind();
		try {
			const rows =
				kind === 'person'
					? await firstValueFrom(this.gateway.searchCustomers(q))
					: await firstValueFrom(this.gateway.searchBusinesses(q));
			this.showIfNewest(asked, rows);
		} catch {
			this.showIfNewest(asked, []);
		}
	}

	/**
	 * Only the newest search's answer is shown; an older one arriving late is dropped. Kept out of the async lookUp()
	 * so V8 counts both outcomes (it miscounts a branch right after an await).
	 */
	private showIfNewest(asked: number, rows: Array<CustomerBuyerOption | BusinessBuyerOption>): void {
		if (asked === this.asked) this.found.set(rows);
	}

	private idOf(buyer: DraftBuyer): string {
		return buyer.kind === 'person' ? buyer.customer.id : buyer.business.id;
	}

	private asBuyer(row: CustomerBuyerOption | BusinessBuyerOption): DraftBuyer {
		return 'legalName' in row ? { kind: 'business', business: row } : { kind: 'person', customer: row };
	}
}

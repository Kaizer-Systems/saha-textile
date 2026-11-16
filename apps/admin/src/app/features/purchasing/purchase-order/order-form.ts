import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { addDays, istDay } from '@saha-textile/core-domain/purchasing';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2SearchEvent, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, apiProblem, apiStatus } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway, injectSuppliersQuery } from '@core/purchasing/purchasing.gateway';
import { injectInventorySettingsQuery } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { injectStoreLocationsQuery } from '@core/stores/store-location.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe } from '@shared/pipes/language.pipes';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import { OrderSend } from './order-send';
import { LineSearch } from '../shared/line-search';
import { parseRupees } from '../shared/payment-popup';
import { VariantGrid, parseQuantity, type GridPick } from '../shared/variant-grid';

import type {
	PurchaseItemOption,
	PurchaseOrder,
	PurchaseOrderLine,
	PurchaseOrderWrite,
	SupplierListRow,
} from '@saha-textile/contracts';

/** One line as the form holds it while typing. */
export interface OrderFormLine {
	lineId?: string;
	variantId: string;
	productId: string;
	sku: string;
	title: string;
	optionsLabel: string;
	soldBy: 'piece' | 'metre';
	imageUrl: string | null;
	lastCostINR: number | null;
	supplierItemCode: string | null;
	gstRatePct: number;
	quantity: string;
	price: string;
	/** Backorder lines this line covers (OD2); kept as saved, empty for new lines. */
	backorderLineIds: string[];
}

/** GST used for the order's estimate only (example rate until the CA's table, round 2 B2.4). */
export const ESTIMATE_GST_PCT = 5;

export function lineFromOption(option: PurchaseItemOption, units: number | null, price: number | null): OrderFormLine {
	return {
		variantId: option.variantId,
		productId: option.productId,
		sku: option.sku,
		title: option.title,
		optionsLabel: option.optionsLabel,
		soldBy: option.soldBy,
		imageUrl: option.imageUrl,
		lastCostINR: option.lastCostINR,
		supplierItemCode: option.supplierItemCode,
		gstRatePct: ESTIMATE_GST_PCT,
		quantity: units === null ? '' : option.soldBy === 'metre' ? (units / 10).toFixed(1) : String(units),
		price: price === null ? (option.lastCostINR === null ? '' : String(option.lastCostINR)) : String(price),
		backorderLineIds: [],
	};
}

export function lineFromOrder(line: PurchaseOrderLine): OrderFormLine {
	return {
		lineId: line.lineId,
		variantId: line.variantId,
		productId: line.productId,
		sku: line.sku,
		title: line.title,
		optionsLabel: line.optionsLabel,
		soldBy: line.soldBy,
		imageUrl: null,
		lastCostINR: line.lastCostINR,
		supplierItemCode: line.supplierItemCode,
		gstRatePct: line.gstRatePct,
		quantity: line.soldBy === 'metre' ? (line.quantity / 10).toFixed(1) : String(line.quantity),
		price: String(line.agreedPriceINR),
		backorderLineIds: line.backorderLineIds ?? [],
	};
}

/** Line value (quantity × agreed price, metres priced per metre) and the GST estimate. */
export function orderEstimate(lines: readonly OrderFormLine[]): {
	linesINR: number;
	gstINR: number;
	totalINR: number;
	rates: number[];
} {
	let lines100 = 0;
	let gst100 = 0;
	for (const line of lines) {
		const quantity = parseQuantity(line.quantity, line.soldBy);
		const price = parseRupees(line.price);
		if (!quantity || !('units' in quantity) || price === null) continue;
		const value = Math.round((line.soldBy === 'metre' ? quantity.units / 10 : quantity.units) * price * 100);
		lines100 += value;
		gst100 += Math.round((value * line.gstRatePct) / 100);
	}
	const rates = [...new Set(lines.map((line) => line.gstRatePct))];
	return { linesINR: lines100 / 100, gstINR: gst100 / 100, totalINR: (lines100 + gst100) / 100, rates };
}

/**
 * New or draft purchase order (po02). It moves no stock and owes no money: the purchase entry made
 * from it does. Lines come from the shared line search or the variant grid; metre products take
 * metres in steps of 0.1. Two people saving one draft: the second is refused with who saved first.
 */
@Component({
	selector: 'app-order-form',
	templateUrl: './order-form.html',
	imports: [
		FormFields,
		FormsModule,
		HasPermissionDirective,
		LineSearch,
		PageWrapper,
		PluralPipe,
		RouterModule,
		RupeesPipe,
		Select2,
		TranslocoModule,
	],
})
export class OrderForm {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly id = signal<string | null>(this.route.snapshot.paramMap.get('id'));
	readonly order = signal<PurchaseOrder | null>(null);
	readonly supplierSearch = signal('');
	private readonly suppliersQuery = injectSuppliersQuery(() => ({
		filter: 'all',
		page: 1,
		pageSize: 30,
		...(this.supplierSearch() ? { q: this.supplierSearch() } : {}),
	}));
	private readonly settings = injectInventorySettingsQuery(() => this.auth.permissions().includes('setting.index'));
	private readonly stores = injectStoreLocationsQuery(() => this.auth.permissions().includes('setting.index'));
	/** Every supplier seen in the picker, so the chosen one keeps its details while the search changes. */
	private readonly known = signal<ReadonlyMap<string, SupplierListRow>>(new Map());

	readonly supplierId = signal<string>('');
	readonly expectedBy = signal(addDays(istDay(new Date()), 10));
	readonly deliverTo = signal('');
	readonly noteToSupplier = signal('');
	readonly internalNote = signal('');
	readonly lines = signal<OrderFormLine[]>([]);
	readonly saving = signal(false);
	readonly dirty = signal(false);
	readonly touched = signal(false);
	readonly conflict = signal<string | null>(null);
	readonly today = istDay(new Date());

	readonly supplier = computed(() => this.known().get(this.supplierId()) ?? null);
	readonly supplierOptions = computed<Select2Data>(() => {
		const rows = this.suppliersQuery.data()?.items ?? [];
		const chosen = this.supplier();
		const list = rows.filter((row) => row.active || row.id === this.supplierId());
		if (chosen && !list.some((row) => row.id === chosen.id)) list.unshift(chosen);
		return list.map((row) => ({ value: row.id, label: row.shortName || row.legalName }));
	});
	readonly addressOptions = computed(() => {
		const list: string[] = [];
		const fallback = this.settings.data()?.defaultDeliverTo;
		if (fallback) list.push(fallback);
		for (const store of this.stores.data() ?? []) {
			const row = store as unknown as {
				name?: Record<string, string>;
				address?: Record<string, string>;
				pinCode?: string;
			};
			const text = [row.name?.['en'], row.address?.['en'], row.pinCode].filter(Boolean).join(' · ');
			if (text && !list.includes(text)) list.push(text);
		}
		return list;
	});
	readonly estimate = computed(() => orderEstimate(this.lines()));
	readonly lineProblems = computed(() =>
		this.lines().map((line) => {
			const quantity = parseQuantity(line.quantity, line.soldBy);
			if (!quantity) return 'qty_required';
			if ('problem' in quantity) return quantity.problem;
			if (quantity.units <= 0) return 'qty_required';
			if (parseRupees(line.price) === null) return 'payment_amount_invalid';
			return null;
		}),
	);
	readonly headerProblems = computed(() => {
		const problems: string[] = [];
		if (!this.supplierId()) problems.push('po_supplier_required');
		if (!this.expectedBy()) problems.push('po_expected_required');
		if (!this.deliverTo().trim()) problems.push('po_deliver_to_required');
		return problems;
	});
	readonly canSave = computed(
		() => !this.saving() && this.headerProblems().length === 0 && this.lineProblems().every((problem) => !problem),
	);

	constructor() {
		effect(() => {
			const rows = this.suppliersQuery.data()?.items ?? [];
			if (!rows.length) return;
			this.known.update((map) => {
				const next = new Map(map);
				for (const row of rows) next.set(row.id, row);
				return next;
			});
		});
		effect(() => {
			const first = this.addressOptions()[0];
			if (first && !this.deliverTo() && !this.id()) this.deliverTo.set(first);
		});
		const id = this.id();
		if (id) void this.load(id);
		else void this.prefillSupplier();
	}

	/** "New purchase order" from a supplier page or the reorder list can name the supplier. */
	private async prefillSupplier(): Promise<void> {
		const supplierId = this.route.snapshot.queryParamMap.get('supplier');
		if (!supplierId) return;
		try {
			const supplier = await firstValueFrom(this.gateway.supplier(supplierId));
			this.remember(supplier as SupplierListRow);
			this.supplierId.set(supplier.id);
		} catch {
			// An unknown supplier id in the address is ignored.
		}
	}

	private remember(row: SupplierListRow): void {
		this.known.update((map) => new Map(map).set(row.id, row));
	}

	private async load(id: string): Promise<void> {
		try {
			const order = await firstValueFrom(this.gateway.order(id));
			if (order.status !== 'draft') {
				void this.router.navigate(['/purchase-orders', id], { replaceUrl: true });
				return;
			}
			this.fill(order);
			try {
				this.remember((await firstValueFrom(this.gateway.supplier(order.supplierId))) as SupplierListRow);
			} catch {
				// The supplier's details line stays empty; the order still saves.
			}
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	private fill(order: PurchaseOrder): void {
		this.order.set(order);
		this.supplierId.set(order.supplierId);
		this.expectedBy.set(order.expectedBy);
		this.deliverTo.set(order.deliverTo);
		this.noteToSupplier.set(order.noteToSupplier ?? '');
		this.internalNote.set(order.internalNote ?? '');
		this.lines.set(order.lines.map(lineFromOrder));
		this.dirty.set(false);
		this.conflict.set(null);
	}

	changed(): void {
		this.dirty.set(true);
	}

	searchSuppliers(event: Select2SearchEvent): void {
		this.supplierSearch.set(event.search ?? '');
	}

	chooseSupplier(event: Select2UpdateEvent): void {
		const value = typeof event.value === 'string' ? event.value : '';
		if (value === this.supplierId()) return;
		this.supplierId.set(value);
		this.changed();
	}

	addOption(option: PurchaseItemOption): void {
		const existing = this.lines().findIndex((line) => line.variantId === option.variantId);
		if (existing >= 0) {
			// The same item again adds one more to its line rather than a second line.
			this.lines.update((lines) =>
				lines.map((line, i) => {
					if (i !== existing) return line;
					const parsed = parseQuantity(line.quantity, line.soldBy);
					const units = parsed && 'units' in parsed ? parsed.units : 0;
					const step = line.soldBy === 'metre' ? 10 : 1;
					const next = units + step;
					return { ...line, quantity: line.soldBy === 'metre' ? (next / 10).toFixed(1) : String(next) };
				}),
			);
		} else {
			this.lines.update((lines) => [...lines, lineFromOption(option, option.soldBy === 'metre' ? 10 : 1, null)]);
		}
		this.changed();
	}

	async openGrid(option: PurchaseItemOption): Promise<void> {
		const popup = this.modals.open(VariantGrid, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'variant_grid_title',
		});
		await (popup.componentInstance as VariantGrid).start(option, this.supplierId() || null, 'agreed_price');
		const picks = (await popup.result.catch(() => null)) as GridPick[] | null;
		if (!picks?.length) return;
		this.lines.update((lines) => {
			const next = [...lines];
			for (const pick of picks) {
				const at = next.findIndex((line) => line.variantId === pick.option.variantId);
				const line = lineFromOption(pick.option, pick.units, pick.priceINR);
				if (at >= 0) next[at] = { ...line, lineId: next[at]?.lineId };
				else next.push(line);
			}
			return next;
		});
		this.changed();
	}

	setLine(index: number, field: 'quantity' | 'price', value: string): void {
		this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
		this.changed();
	}

	removeLine(index: number): void {
		this.lines.update((lines) => lines.filter((_, i) => i !== index));
		this.changed();
	}

	lineValue(line: OrderFormLine): number | null {
		const quantity = parseQuantity(line.quantity, line.soldBy);
		const price = parseRupees(line.price);
		if (!quantity || !('units' in quantity) || price === null) return null;
		return Math.round((line.soldBy === 'metre' ? quantity.units / 10 : quantity.units) * price * 100) / 100;
	}

	body(): PurchaseOrderWrite {
		const order = this.order();
		return {
			supplierId: this.supplierId(),
			expectedBy: this.expectedBy(),
			deliverTo: this.deliverTo().trim(),
			noteToSupplier: this.noteToSupplier().trim() || null,
			internalNote: this.internalNote().trim() || null,
			lines: this.lines().map((line) => {
				const quantity = parseQuantity(line.quantity, line.soldBy);
				return {
					...(line.lineId ? { lineId: line.lineId } : {}),
					variantId: line.variantId,
					quantity: quantity && 'units' in quantity ? quantity.units : 0,
					agreedPriceINR: parseRupees(line.price) ?? 0,
					gstRatePct: line.gstRatePct,
					supplierItemCode: line.supplierItemCode,
					backorderLineIds: line.backorderLineIds,
				};
			}),
			...(order ? { version: order.version } : {}),
		};
	}

	/** Saves the draft; resolves with the saved order, or null when it was refused. */
	async save(quietly = false): Promise<PurchaseOrder | null> {
		this.touched.set(true);
		if (!this.canSave()) return null;
		this.saving.set(true);
		this.conflict.set(null);
		try {
			const saved = await firstValueFrom(this.gateway.saveOrder(this.order()?.id ?? null, this.body()));
			const created = !this.order();
			this.fill(saved);
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.orders });
			if (!quietly) this.notifier.showSuccess(this.transloco.translate('po_saved', { number: saved.number }));
			if (created) {
				this.id.set(saved.id);
				void this.router.navigate(['/purchase-orders', saved.id, 'edit'], { replaceUrl: true });
			}
			return saved;
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
			if (apiStatus(error) === 409) this.conflict.set(message);
			else this.notifier.showError(message);
			return null;
		} finally {
			this.saving.set(false);
		}
	}

	/** Two people on one draft: reload theirs (yours is dropped, as the message says). */
	async reload(): Promise<void> {
		const id = this.order()?.id;
		if (id) await this.load(id);
	}

	/** Send to the supplier (po03): saves first, then the send popup; sending marks the order Sent. */
	async send(): Promise<void> {
		const saved = this.dirty() || !this.order() ? await this.save(true) : this.order();
		if (!saved) return;
		const popup = this.modals.open(OrderSend, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'order_send_title',
		});
		(popup.componentInstance as OrderSend).start(saved, this.supplier()?.email ?? null);
		const sent = (await popup.result.catch(() => null)) as PurchaseOrder | null;
		if (!sent) return;
		void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.orders });
		this.notifier.showSuccess(this.transloco.translate('po_sent', { number: sent.number }));
		void this.router.navigate(['/purchase-orders', sent.id]);
	}

	cancel(): void {
		const id = this.order()?.id;
		void this.router.navigate(id ? ['/purchase-orders', id] : ['/purchase-orders']);
	}
}

import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { istDay } from '@saha-textile/core-domain/purchasing';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data, type Select2SearchEvent, type Select2UpdateEvent } from 'ng-select2-component';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, StockQuantityPipe, apiIssues, apiProblem, apiStatus } from '@core/purchasing/purchasing-format';
import { PURCHASING_KEYS, PurchasingGateway, injectSuppliersQuery } from '@core/purchasing/purchasing.gateway';
import { injectInventorySettingsQuery } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { PluralPipe, translateCount } from '@shared/pipes/language.pipes';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import { DraftProductPopup } from './draft-product-popup';
import {
	GST_RATES,
	dateNotes,
	entryWrite,
	lineFromEntry,
	lineFromItem,
	lineProblem,
	mergeSaved,
	previewEntry,
	type EntryFormLine,
	type EntryHeader,
	warningText,
} from './entry-lines';
import { ImportPopup } from './import-popup';
import { LineSearch } from '../shared/line-search';
import { linesQuantity } from '../shared/purchasing-labels';
import { VariantGrid, parseQuantity, type GridPick } from '../shared/variant-grid';

import type {
	PurchaseEntry,
	PurchaseItemOption,
	PurchaseOrder,
	PurchaseWarning,
	SupplierListRow,
} from '@saha-textile/contracts';

/** Freight on a supplier's bill is part of the supply, so it takes the GST rate of most of the bill's value. */
export function freightRate(lines: readonly EntryFormLine[]): number {
	const byRate = new Map<number, number>();
	for (const line of lines) {
		const quantity = parseQuantity(line.quantity, line.soldBy);
		const price = Number(line.price.replace(/[₹,\s]/g, '')) || 0;
		if (!quantity || !('units' in quantity)) continue;
		const value = (line.soldBy === 'metre' ? quantity.units / 10 : quantity.units) * price;
		byRate.set(line.gstRatePct, (byRate.get(line.gstRatePct) ?? 0) + value);
	}
	let best = 0;
	let bestValue = -1;
	for (const [rate, value] of byRate) {
		if (value > bestValue) {
			best = rate;
			bestValue = value;
		}
	}
	return best;
}

/**
 * A purchase entry being typed (p02–p07, po04b): the supplier's bill header, its lines with the
 * arithmetic worked out in the browser exactly as the API does it, and the checks before the goods
 * can be counted. Nothing touches stock until the entry is posted.
 */
@Component({
	selector: 'app-entry-form',
	templateUrl: './entry-form.html',
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
		StockQuantityPipe,
		TranslocoModule,
	],
})
export class EntryForm {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly gateway = inject(PurchasingGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);
	private readonly auth = inject(AuthStore);

	readonly rates = GST_RATES;
	readonly today = istDay(new Date());
	readonly entry = signal<PurchaseEntry | null>(null);
	readonly canSeeCost = computed(() => this.auth.permissions().includes('stock.cost'));
	/** A draft product needs both purchase and product rights (the API checks both). */
	readonly canMakeProducts = computed(() => this.auth.permissions().includes('product.create'));

	/* header */
	readonly supplierId = signal('');
	readonly purchaseOrderId = signal<string | null>(null);
	readonly billNumber = signal('');
	readonly billDate = signal(this.today);
	readonly goodsReceivedOn = signal(this.today);
	readonly pricesIncludeGst = signal(false);
	readonly freight = signal('');
	readonly roundOff = signal('0');
	readonly printedTotal = signal('');
	readonly attachment = signal<{ assetId: string; name: string } | null>(null);
	readonly lines = signal<EntryFormLine[]>([]);

	readonly saving = signal(false);
	readonly dirty = signal(false);
	readonly touched = signal(false);
	readonly conflict = signal<string | null>(null);
	readonly duplicate = signal<{ message: string; id: string | null } | null>(null);
	readonly fieldErrors = signal<Record<string, string>>({});

	/* supplier picker */
	readonly supplierSearch = signal('');
	private readonly suppliersQuery = injectSuppliersQuery(() => ({
		filter: 'all',
		page: 1,
		pageSize: 30,
		...(this.supplierSearch() ? { q: this.supplierSearch() } : {}),
	}));
	private readonly known = signal<ReadonlyMap<string, SupplierListRow>>(new Map());
	readonly supplier = computed(() => this.known().get(this.supplierId()) ?? null);
	readonly supplierOptions = computed<Select2Data>(() => {
		const rows = (this.suppliersQuery.data()?.items ?? []).filter(
			(row) => row.active || row.id === this.supplierId(),
		);
		const chosen = this.supplier();
		if (chosen && !rows.some((row) => row.id === chosen.id)) rows.unshift(chosen);
		return rows.map((row) => ({ value: row.id, label: row.shortName || row.legalName }));
	});

	/* the supplier's open orders, for the first field (p02) */
	private readonly openOrdersQuery = injectQuery(() => ({
		queryKey: [...PURCHASING_KEYS.orders, 'open-for', this.supplierId()],
		queryFn: () =>
			firstValueFrom(
				this.gateway.orders({ supplierId: this.supplierId(), filter: 'all', page: 1, pageSize: 100 }),
			),
		enabled: !!this.supplierId() && this.auth.permissions().includes('purchase_order.index'),
	}));
	readonly openOrders = computed<PurchaseOrder[]>(() =>
		(this.openOrdersQuery.data()?.items ?? []).filter(
			(order) =>
				order.status === 'sent' || order.status === 'part_received' || order.id === this.purchaseOrderId(),
		),
	);
	readonly order = signal<PurchaseOrder | null>(null);

	private readonly settingsQuery = injectInventorySettingsQuery(() =>
		this.auth.permissions().includes('setting.index'),
	);
	readonly settings = computed(() => ({
		priceChangeWarnPct: this.settingsQuery.data()?.priceChangeWarnPct ?? 10,
		marginFloorPct: this.settingsQuery.data()?.marginFloorPct ?? 20,
		booksClosedUpTo: this.settingsQuery.data()?.booksClosedUpTo ?? null,
	}));

	/** Worked out by the API from the supplier's kind and State against the shop's (never typed). */
	readonly taxType = computed(() => this.supplier()?.taxType ?? this.entry()?.taxType ?? 'none');
	readonly header = computed<EntryHeader>(() => {
		const kind = this.supplier()?.kind ?? this.entry()?.supplierKind ?? 'regular';
		return {
			taxType: this.taxType(),
			itcClaimable: kind === 'regular',
			pricesIncludeGst: this.pricesIncludeGst(),
			freight: this.freight(),
			freightGstRatePct: freightRate(this.lines()),
			roundOff: this.roundOff(),
			printedTotal: this.printedTotal(),
		};
	});
	readonly preview = computed(() => previewEntry(this.header(), this.lines(), this.settings()));
	readonly mathByLine = computed(() => new Map(this.preview().lines.map((line) => [line.lineId, line])));
	readonly warningsByLine = computed(() => {
		const map = new Map<string, PurchaseWarning[]>();
		for (const warning of this.preview().warnings) {
			const list = map.get(warning.lineId) ?? [];
			list.push({ ...warning, lineId: warning.lineId });
			map.set(warning.lineId, list);
		}
		return map;
	});
	/** Warnings the API added on save that the browser cannot know (a lookalike bill). */
	readonly serverWarnings = computed(() =>
		(this.entry()?.warnings ?? []).filter((warning) => warning.code === 'lookalike_bill' && !this.dirty()),
	);
	readonly warningCount = computed(() => this.preview().warnings.length + this.serverWarnings().length);
	readonly problems = computed(() => this.lines().map(lineProblem));
	readonly dates = computed(() =>
		dateNotes({
			billDate: this.billDate(),
			goodsReceivedOn: this.goodsReceivedOn(),
			today: this.today,
			booksClosedUpTo: this.settings().booksClosedUpTo,
		}),
	);
	readonly totals = computed(() => this.preview().totals);
	readonly totalMismatch = computed(() => {
		const totals = this.totals();
		return totals.printedTotalINR !== null && !totals.matchesPrinted;
	});
	readonly headerProblems = computed(() => {
		const list: string[] = [];
		if (!this.supplierId()) list.push('pe_supplier_required');
		if (!this.billNumber().trim()) list.push('pe_bill_number_required');
		if (!this.billDate()) list.push('pe_bill_date_required');
		if (!this.goodsReceivedOn()) list.push('pe_received_required');
		if (this.dates().refusal) list.push('books_closed');
		return list;
	});
	readonly canSave = computed(
		() => !this.saving() && this.headerProblems().length === 0 && this.problems().every((p) => !p),
	);
	/** Check goods waits for lines, a typed bill total, and a match within ₹1 (p02, p06). */
	readonly checkBlock = computed<string | null>(() => {
		if (!this.lines().length) return 'pe_add_lines_first';
		if (this.problems().some((problem) => problem)) return 'pe_fix_lines_first';
		if (!this.printedTotal().trim()) return 'pe_type_printed_total';
		if (this.totalMismatch()) return 'pe_total_mismatch_short';
		return null;
	});
	/** Pieces and metres on the bill, for the Lines heading. */
	readonly lineUnits = computed(() =>
		this.lines()
			.map((line) => ({ line, quantity: parseQuantity(line.quantity, line.soldBy) }))
			.filter((row) => row.quantity && 'units' in row.quantity)
			.map((row) => ({ quantity: (row.quantity as { units: number }).units, soldBy: row.line.soldBy })),
	);

	readonly lineUnitsText = computed(() =>
		linesQuantity(
			this.lineUnits(),
			(key, n) => translateCount(this.transloco, key, n),
			(key, params) => this.transloco.translate(key, params),
			this.transloco.getActiveLang(),
		),
	);
	readonly blockText = computed(() => {
		const block = this.checkBlock();
		return block ? this.transloco.translate(block) : '';
	});

	/** A margin as an object, so 0% still shows (a bare 0 would read as "no margin"). */
	marginOf(line: EntryFormLine): { value: number } | null {
		const margin = this.mathByLine().get(line.key)?.marginPct;
		return margin === null || margin === undefined ? null : { value: Math.round(margin * 10) / 10 };
	}

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
		const id = this.route.snapshot.paramMap.get('id');
		const query = this.route.snapshot.queryParamMap;
		if (id) void this.load(id);
		else if (query.get('order')) void this.fromOrder(query.get('order') as string);
		else if (query.get('copy')) void this.fromCopy(query.get('copy') as string);
		else {
			const supplierId = query.get('supplier');
			if (supplierId) void this.useSupplier(supplierId);
			const variant = query.get('variant');
			if (variant) void this.fromVariant(variant);
			// "Import lines" on the entries list opens a new entry with the import popup (p01, p13).
			if (query.get('import')) setTimeout(() => void this.importLines());
		}
	}

	private remember(row: SupplierListRow): void {
		this.known.update((map) => new Map(map).set(row.id, row));
	}

	private async useSupplier(id: string): Promise<void> {
		try {
			this.remember((await firstValueFrom(this.gateway.supplier(id))) as SupplierListRow);
			this.supplierId.set(id);
		} catch {
			// An unknown supplier in the address is ignored.
		}
	}

	private async load(id: string): Promise<void> {
		try {
			const entry = await firstValueFrom(this.gateway.entry(id));
			if (entry.status === 'posted' || entry.status === 'void') {
				void this.router.navigate(['/purchase-entries', id], { replaceUrl: true });
				return;
			}
			this.fill(entry);
			await this.useSupplier(entry.supplierId);
			if (entry.purchaseOrderId) this.order.set(await firstValueFrom(this.gateway.order(entry.purchaseOrderId)));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	private fill(entry: PurchaseEntry): void {
		this.entry.set(entry);
		this.supplierId.set(entry.supplierId);
		this.purchaseOrderId.set(entry.purchaseOrderId);
		this.billNumber.set(entry.billNumber);
		this.billDate.set(entry.billDate);
		this.goodsReceivedOn.set(entry.goodsReceivedOn);
		this.pricesIncludeGst.set(entry.pricesIncludeGst);
		this.freight.set(entry.freightINR ? String(entry.freightINR) : '');
		this.roundOff.set(String(entry.roundOffINR));
		this.printedTotal.set(entry.totals.printedTotalINR === null ? '' : String(entry.totals.printedTotalINR));
		this.attachment.set(
			entry.billAttachment ? { assetId: entry.billAttachment.assetId, name: entry.billAttachment.name } : null,
		);
		this.lines.set(mergeSaved(entry, this.lines()));
		this.dirty.set(false);
		this.conflict.set(null);
	}

	/** Receive goods from an order (po04b): lines are what is still to come. */
	private async fromOrder(orderId: string): Promise<void> {
		try {
			const [order, draft] = await Promise.all([
				firstValueFrom(this.gateway.order(orderId)),
				firstValueFrom(this.gateway.receiveDraft(orderId)),
			]);
			this.order.set(order);
			await this.useSupplier(order.supplierId);
			this.purchaseOrderId.set(order.id);
			const items = await firstValueFrom(
				this.gateway.itemsByVariant(
					draft.lines.map((line) => line.variantId),
					order.supplierId,
				),
			);
			const byVariant = new Map(items.map((item) => [item.variantId, item]));
			const lines: EntryFormLine[] = [];
			for (const write of draft.lines) {
				const item = byVariant.get(write.variantId);
				const orderLine = order.lines.find((line) => line.lineId === write.purchaseOrderLineId);
				if (!item) continue;
				lines.push({
					...lineFromItem(item, write.quantity, write.unitPriceINR),
					gstRatePct: write.gstRatePct,
					purchaseOrderLineId: write.purchaseOrderLineId,
					ordered: orderLine?.quantity ?? null,
					alreadyReceived: orderLine?.receivedQuantity ?? null,
				});
			}
			this.lines.set(lines);
			this.dirty.set(true);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	/** Copy as new draft (p01): the same supplier and lines, a new bill number to type. */
	private async fromCopy(entryId: string): Promise<void> {
		try {
			const source = await firstValueFrom(this.gateway.entry(entryId));
			await this.useSupplier(source.supplierId);
			this.pricesIncludeGst.set(source.pricesIncludeGst);
			this.lines.set(
				source.lines.map((line) => ({
					...lineFromEntry(line),
					key: `${line.lineId}-copy`,
					lineId: undefined,
					purchaseOrderLineId: null,
					notOrdered: false,
				})),
			);
			this.dirty.set(true);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	/** Receive stock from the stock list (i01): one line for that item. */
	private async fromVariant(variantId: string): Promise<void> {
		try {
			const [item] = await firstValueFrom(this.gateway.itemsByVariant([variantId], this.supplierId() || null));
			if (item) this.addOption(item);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	changed(): void {
		this.dirty.set(true);
		this.duplicate.set(null);
	}

	searchSuppliers(event: Select2SearchEvent): void {
		this.supplierSearch.set(event.search ?? '');
	}

	chooseSupplier(event: Select2UpdateEvent): void {
		const value = typeof event.value === 'string' ? event.value : '';
		if (value === this.supplierId()) return;
		this.supplierId.set(value);
		if (this.order()?.supplierId !== value) {
			this.order.set(null);
			this.purchaseOrderId.set(null);
		}
		this.changed();
	}

	/** Picking an open order fills the lines with what is still to arrive (p02 first field). */
	async chooseOrder(id: string): Promise<void> {
		if (!id) {
			this.order.set(null);
			this.purchaseOrderId.set(null);
			this.lines.update((lines) =>
				lines.map((line) => ({
					...line,
					purchaseOrderLineId: null,
					notOrdered: false,
					ordered: null,
					alreadyReceived: null,
				})),
			);
			this.changed();
			return;
		}
		// Lines typed already stay, marked "not ordered"; the order's lines join them.
		const typed = this.lines().filter((line) => !line.purchaseOrderLineId);
		await this.fromOrder(id);
		this.lines.update((lines) => [...lines, ...typed.map((line) => ({ ...line, notOrdered: true }))]);
	}

	addOption(option: PurchaseItemOption): void {
		const at = this.lines().findIndex((line) => line.variantId === option.variantId && !line.freeOnBill);
		if (at >= 0) {
			this.lines.update((lines) =>
				lines.map((line, i) => {
					if (i !== at) return line;
					const parsed = parseQuantity(line.quantity, line.soldBy);
					const next = (parsed && 'units' in parsed ? parsed.units : 0) + (line.soldBy === 'metre' ? 10 : 1);
					return { ...line, quantity: line.soldBy === 'metre' ? (next / 10).toFixed(1) : String(next) };
				}),
			);
		} else {
			const line = lineFromItem(option, option.soldBy === 'metre' ? 10 : 1, null);
			// With an order chosen, a line not on it is marked so in the activity (po04b).
			this.lines.update((lines) => [...lines, { ...line, notOrdered: !!this.purchaseOrderId() }]);
		}
		this.changed();
	}

	async openGrid(option: PurchaseItemOption): Promise<void> {
		const popup = this.modals.open(VariantGrid, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'variant_grid_title',
		});
		await (popup.componentInstance as VariantGrid).start(option, this.supplierId() || null);
		const picks = (await popup.result.catch(() => null)) as GridPick[] | null;
		if (!picks?.length) return;
		this.lines.update((lines) => {
			const next = [...lines];
			for (const pick of picks) {
				const line = {
					...lineFromItem(pick.option, pick.units, pick.priceINR),
					notOrdered: !!this.purchaseOrderId(),
				};
				const at = next.findIndex((row) => row.variantId === pick.option.variantId && !row.freeOnBill);
				if (at >= 0) {
					// Never-run fallback removed: `at` came from findIndex, so that row is there.
					const old = next[at] as EntryFormLine;
					next[at] = { ...line, key: old.key, lineId: old.lineId };
				} else next.push(line);
			}
			return next;
		});
		this.changed();
	}

	/** New design arrived (p05): a draft product made from the line, then the line. */
	async makeDraft(name: string): Promise<void> {
		const popup = this.modals.open(DraftProductPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'draft_product_title',
		});
		(popup.componentInstance as DraftProductPopup).start(name, this.supplierId() || null);
		const option = (await popup.result.catch(() => null)) as PurchaseItemOption | null;
		if (option) this.addOption(option);
	}

	/** Import lines from the supplier's spreadsheet (p13): only Ready rows are added. */
	async importLines(): Promise<void> {
		const popup = this.modals.open(ImportPopup, {
			size: 'xl',
			windowClass: 'theme-modal modal-xl',
			ariaLabelledBy: 'import_popup_title',
		});
		(popup.componentInstance as ImportPopup).start(this.supplierId() || null);
		const added = (await popup.result.catch(() => null)) as EntryFormLine[] | null;
		if (!added?.length) return;
		const ordered = !!this.purchaseOrderId();
		this.lines.update((lines) => [...lines, ...added.map((line) => ({ ...line, notOrdered: ordered }))]);
		this.changed();
	}

	setLine<K extends 'quantity' | 'price' | 'hsnOnBill'>(index: number, field: K, value: string): void {
		this.lines.update((lines) => lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
		this.changed();
	}

	setRate(index: number, rate: number): void {
		this.lines.update((lines) =>
			lines.map((line, i) => (i === index ? { ...line, gstRatePct: Number(rate) } : line)),
		);
		this.changed();
	}

	setFree(index: number, free: boolean): void {
		this.lines.update((lines) =>
			lines.map((line, i) =>
				i === index ? { ...line, freeOnBill: free, price: free ? '0' : line.price } : line,
			),
		);
		this.changed();
	}

	removeLine(index: number): void {
		this.lines.update((lines) => lines.filter((_, i) => i !== index));
		this.changed();
	}

	async pickBill(): Promise<void> {
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'pe_pick_bill_copy',
			accept: 'any',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (picked?.[0]) {
			this.attachment.set({ assetId: picked[0].assetId, name: picked[0].name });
			this.changed();
		}
	}

	warnText(warning: PurchaseWarning, line?: EntryFormLine): string {
		const money = (value: number) =>
			new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(
				value,
			);
		return warningText(
			warning,
			(key, params) => this.transloco.translate(key, params),
			money,
			line?.lastEntryNumber ?? null,
		);
	}

	/** Saves the draft; resolves with the saved entry, or null when refused. */
	async save(quietly = false): Promise<PurchaseEntry | null> {
		this.touched.set(true);
		if (!this.canSave()) return null;
		this.saving.set(true);
		this.conflict.set(null);
		this.duplicate.set(null);
		this.fieldErrors.set({});
		const current = this.entry();
		try {
			const saved = await firstValueFrom(
				this.gateway.saveEntry(
					current?.id ?? null,
					entryWrite({
						supplierId: this.supplierId(),
						purchaseOrderId: this.purchaseOrderId(),
						billNumber: this.billNumber(),
						billDate: this.billDate(),
						goodsReceivedOn: this.goodsReceivedOn(),
						header: this.header(),
						billAttachmentAssetId: this.attachment()?.assetId ?? null,
						lines: this.lines(),
						...(current ? { version: current.version } : {}),
					}),
				),
			);
			this.fill(saved);
			void this.queryClient.invalidateQueries({ queryKey: PURCHASING_KEYS.entries });
			if (!quietly) this.notifier.showSuccess(this.transloco.translate('pe_draft_saved'));
			if (!current) void this.router.navigate(['/purchase-entries', saved.id, 'edit'], { replaceUrl: true });
			return saved;
		} catch (error) {
			const message = apiProblem(error, this.transloco.translate('purchasing_action_failed'));
			const issues = apiIssues(error);
			const duplicate = issues.find((issue) => issue.code === 'duplicate_bill');
			if (apiStatus(error) === 409) this.conflict.set(message);
			else if (duplicate) this.duplicate.set({ message: duplicate.message, id: duplicate.target });
			else {
				const fields: Record<string, string> = {};
				for (const issue of issues) fields[issue.target ?? issue.code] = issue.message;
				this.fieldErrors.set(fields);
				this.notifier.showError(message);
			}
			return null;
		} finally {
			this.saving.set(false);
		}
	}

	async reload(): Promise<void> {
		const id = this.entry()?.id;
		if (id) await this.load(id);
	}

	/** Check goods (p08): saved first, then the parcel is counted. */
	async checkGoods(): Promise<void> {
		if (this.checkBlock()) return;
		const saved = this.dirty() || !this.entry() ? await this.save(true) : this.entry();
		if (!saved) return;
		void this.router.navigate(['/purchase-entries', saved.id, 'check']);
	}

	cancel(): void {
		const id = this.entry()?.id;
		void this.router.navigate(id ? ['/purchase-entries', id] : ['/purchase-entries']);
	}
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
	InventorySettings,
	LabelField,
	LabelSheetRequest,
	PurchaseEntry,
	PurchaseReturn,
	Supplier,
} from '@saha-textile/contracts';
import {
	type DocumentAsset,
	type DocumentRenderRequest,
	type DocumentRendererPort,
	type PurchaseEntryRepository,
	type PurchaseReturnRepository,
	type StockReadRepository,
	type SupplierRepository,
	LABEL_SHEETS,
	code128Bars,
	code128Encodable,
	formatQuantity,
	formatRupees,
	labelSlots,
	sheetsNeeded,
} from '@saha-textile/core-domain';

import {
	DOCUMENT_RENDERER,
	PURCHASE_ENTRY_REPOSITORY,
	PURCHASE_RETURN_REPOSITORY,
	STOCK_READ_REPOSITORY,
	SUPPLIER_REPOSITORY,
} from '../infra/tokens';
import { PurchaseOrderDocument, escapeHtml, longDate } from './purchase-order-document';
import { PurchasingSupport, missing, refuse } from './purchasing-support';

/** Most labels one print may hold (P10: many items on as few sheets as possible). */
export const MAX_LABELS = 2000;

type Brand = { hasLogo: boolean; shopName: string; themeColor: string | null };

/** Our own name, address and GSTIN at the top of a document (shop details, R3-1; until then the PO's block). */
function ourBlock(settings: InventorySettings, brand: Brand): { name: string; html: string } {
	const business = settings.business;
	const name = business.legalName || brand.shopName;
	return {
		name,
		html: [
			`<li><strong>${escapeHtml(name)}</strong></li>`,
			...business.addressLines.filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`),
			business.gstin ? `<li>GSTIN ${escapeHtml(business.gstin)}</li>` : '',
		].join(''),
	};
}

function theirBlock(name: string, supplier: Supplier | null): string {
	return [
		`<li class="theme-color">To : <span class="text-content">${escapeHtml(supplier?.legalName ?? name)}</span></li>`,
		supplier
			? `<li class="text-content">${escapeHtml([supplier.address.line, supplier.address.city, `${supplier.stateName} ${supplier.address.pin}`].filter(Boolean).join(', '))}</li>`
			: '',
		supplier?.gstin
			? `<li class="theme-color">GSTIN : <span class="text-content">${escapeHtml(supplier.gstin)} (State ${escapeHtml(supplier.stateCode)})</span></li>`
			: '',
	].join('');
}

/** The vendor invoice template's page around a document's own body. */
function page(title: string, heading: string, brand: Brand, body: string, signedFor: string): string {
	const header = brand.hasLogo
		? `<img src="logo" alt="${escapeHtml(brand.shopName)}">`
		: `<span class="shop-name">${escapeHtml(brand.shopName)}</span>`;
	const colour = brand.themeColor ? `<style>:root{--theme-color:${brand.themeColor}}</style>` : '';
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="invoice-1.css">${colour}</head>
<body><section class="theme-invoice-1"><div class="invoice-wrapper">
<div class="invoice-header"><div class="header-image">${header}</div><div class="header-content"><h3>${escapeHtml(heading)}</h3></div></div>
<div class="invoice-body">${body}</div>
<div class="invoice-footer"><div class="signature-box"><h5>For ${escapeHtml(signedFor)}</h5></div></div>
</div></section></body></html>`;
}

const row = (cells: readonly string[]) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;

/**
 * The printable documents of purchases and stock beside the purchase order: the goods receipt
 * (p01), the debit note and delivery challan of a sent return (r04), and A4 barcode label sheets
 * (l01). Each is drawn from the vendor's invoice template (or exact label geometry) and printed by
 * the Chromium renderer in the worker, with the network closed.
 */
@Injectable()
export class PurchasingPrints {
	constructor(
		@Inject(PURCHASE_ENTRY_REPOSITORY) private readonly entries: PurchaseEntryRepository,
		@Inject(PURCHASE_RETURN_REPOSITORY) private readonly returns: PurchaseReturnRepository,
		@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
		@Inject(STOCK_READ_REPOSITORY) private readonly stock: StockReadRepository,
		private readonly orderDocument: PurchaseOrderDocument,
		private readonly support: PurchasingSupport,
		@Optional() @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentRendererPort | null = null,
	) {}

	private async print(
		build: (brand: Brand, settings: InventorySettings) => { html: string; title: string },
		extra: DocumentAsset[] = [],
	) {
		if (!this.renderer) throw refuse('pdf_unavailable', 'PDFs cannot be made on this server yet.');
		const [assets, logo, settings] = await Promise.all([
			this.orderDocument.loadStatic(),
			this.orderDocument.logo(),
			this.support.settings(),
		]);
		const brand: Brand = { hasLogo: Boolean(logo.asset), shopName: logo.shopName, themeColor: logo.themeColor };
		const { html, title } = build(brand, settings);
		const request: DocumentRenderRequest = {
			html,
			assets: [...assets, ...(logo.asset ? [logo.asset] : []), ...extra],
			title,
			author: settings.business.legalName || logo.shopName,
			page: { size: 'A4', landscape: false, marginMm: { top: 14, right: 12, bottom: 16, left: 12 } },
		};
		return this.renderer.renderPdf(request);
	}

	/* ------------------------------------------------------------ goods receipt (p01) */

	receiptHtml(entry: PurchaseEntry, supplier: Supplier | null, settings: InventorySettings, brand: Brand): string {
		const ours = ourBlock(settings, brand);
		const lines = entry.lines
			.map((line, index) =>
				row([
					`<span class="text-content">${index + 1}</span>`,
					`<ul class="text-start item-detail"><li>${escapeHtml([line.title, line.optionsLabel].filter(Boolean).join(', '))}</li><li class="text-content">${escapeHtml(line.sku)}</li></ul>`,
					escapeHtml(formatQuantity(line.quantity, line.soldBy)),
					escapeHtml(formatQuantity(line.accepted ?? 0, line.soldBy)),
					escapeHtml(formatQuantity(line.damaged, line.soldBy)),
					escapeHtml(formatQuantity(line.missing, line.soldBy)),
				]),
			)
			.join('');
		const body = `<div class="top-sec"><div class="details-box"><div class="address-box"><ul>${ours.html}</ul></div><div class="address-box"><ul>${theirBlock(entry.supplierName, supplier)}</ul></div></div></div>
<div class="invoice-table"><table class="table"><thead><tr><th>Entry no.</th><th>Their bill</th><th>Bill date</th><th>Goods received</th></tr></thead>
<tbody>${row([escapeHtml(entry.number ?? 'Not posted yet'), escapeHtml(entry.billNumber), escapeHtml(longDate(entry.billDate)), escapeHtml(longDate(entry.goodsReceivedOn))])}</tbody></table></div>
<div class="invoice-table-2"><table class="table"><thead><tr><th>No.</th><th class="text-start">Item</th><th>On the bill</th><th>Good</th><th>Damaged</th><th>Missing</th></tr></thead><tbody>${lines}</tbody></table></div>
<p class="text-content mt-3 mb-0">Damaged pieces go back to the supplier on a return; missing pieces are claimed on a debit note.</p>`;
		return page(`Goods receipt ${entry.number ?? entry.billNumber}`, 'Goods receipt', brand, body, ours.name);
	}

	async receiptPdf(id: string): Promise<{ fileName: string; data: Uint8Array }> {
		const entry = await this.entries.findById(id);
		if (!entry) throw missing('Purchase entry');
		if (entry.status === 'draft')
			throw refuse('goods_not_checked', 'Check the goods first: the receipt shows what was counted.');
		const supplier = await this.suppliers.findById(entry.supplierId);
		const data = await this.print((brand, settings) => ({
			html: this.receiptHtml(entry, supplier, settings, brand),
			title: `Goods receipt ${entry.number ?? entry.billNumber}`,
		}));
		return {
			fileName: `goods-receipt-${(entry.number ?? entry.billNumber).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
			data,
		};
	}

	/* ------------------------------------------------------------ debit note and challan (r04) */

	returnHtml(
		kind: 'debit-note' | 'challan',
		doc: PurchaseReturn,
		entry: PurchaseEntry | null,
		supplier: Supplier | null,
		settings: InventorySettings,
		brand: Brand,
	): string {
		const ours = ourBlock(settings, brand);
		const heading = kind === 'challan' ? 'Delivery challan' : 'Debit note';
		const number = kind === 'challan' ? doc.challanNumber : doc.number;
		const taxHead = doc.taxType === 'intra_state' ? 'CGST + SGST' : doc.taxType === 'inter_state' ? 'IGST' : 'GST';
		const lines = doc.lines
			.map((line, index) => {
				const entryLine = entry?.lines.find((candidate) => candidate.lineId === line.entryLineId);
				const hsn = entryLine?.hsnOnBill ?? entryLine?.productHsn ?? '';
				return row([
					`<span class="text-content">${index + 1}</span>`,
					`<ul class="text-start item-detail"><li>${escapeHtml([line.title, line.optionsLabel].filter(Boolean).join(', '))}</li><li class="text-content">${escapeHtml([line.sku, hsn ? `HSN ${hsn}` : ''].filter(Boolean).join(' · '))}</li></ul>`,
					escapeHtml(formatQuantity(line.quantity, line.soldBy)),
					escapeHtml(formatRupees(line.unitCostINR)),
					escapeHtml(formatRupees(line.taxableINR)),
					`${escapeHtml(formatRupees(line.taxINR))}<br><span class="text-content">${escapeHtml(`${line.gstRatePct}%`)}</span>`,
					escapeHtml(formatRupees(line.totalINR)),
				]);
			})
			.join('');
		const reason = {
			damaged_on_arrival: 'Damaged on arrival',
			wrong_item: 'Wrong item',
			short_supplied: 'Short supplied',
			quality_after_accepting: 'Quality problem found after accepting',
			extra_sent: 'Extra pieces sent',
			other: 'Other',
		}[doc.reason];
		const reference = [
			`Against your bill ${escapeHtml(entry?.billNumber ?? '')}${entry ? ` of ${escapeHtml(longDate(entry.billDate))}` : ''} (our ${escapeHtml(doc.purchaseEntryNumber ?? '')})`,
			kind === 'challan' && doc.courier
				? `Sent by ${escapeHtml(doc.courier)}${doc.docket ? `, docket ${escapeHtml(doc.docket)}` : ''}`
				: '',
		]
			.filter(Boolean)
			.join('. ');
		const body = `<div class="top-sec"><div class="details-box"><div class="address-box"><ul>${ours.html}</ul></div><div class="address-box"><ul>${theirBlock(doc.supplierName, supplier)}</ul></div></div></div>
<div class="invoice-table"><table class="table"><thead><tr><th>${escapeHtml(heading)} no.</th><th>Date</th><th>Reason</th><th>Tax</th></tr></thead>
<tbody>${row([escapeHtml(number ?? ''), escapeHtml(doc.sentAt ? longDate(doc.sentAt.slice(0, 10)) : ''), escapeHtml(reason), escapeHtml(taxHead)])}</tbody></table></div>
<div class="invoice-table-2"><table class="table"><thead><tr><th>No.</th><th class="text-start">Item</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>${escapeHtml(taxHead)}</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table></div>
<div class="price-box"><ul><li>TOTAL</li><li class="theme-color">${escapeHtml(formatRupees(doc.totalINR))}</li></ul></div>
<p class="text-content mt-3 mb-0">${reference}.${doc.noteToSupplier ? ` ${escapeHtml(doc.noteToSupplier)}` : ''}${kind === 'challan' ? ' Goods returned to the supplier; not a sale.' : ''}</p>`;
		return page(`${heading} ${number ?? ''}`, heading, brand, body, ours.name);
	}

	async returnPdf(id: string, kind: 'debit-note' | 'challan'): Promise<{ fileName: string; data: Uint8Array }> {
		const doc = await this.returns.findById(id);
		if (!doc) throw missing('Purchase return');
		if (doc.status === 'draft' || !doc.number)
			throw refuse('not_sent', 'The debit note gets its number when it is sent.');
		if (kind === 'challan' && !doc.challanNumber)
			throw refuse('no_challan', 'No goods travelled on this return, so it has no challan.');
		const [entry, supplier] = await Promise.all([
			this.entries.findById(doc.purchaseEntryId),
			this.suppliers.findById(doc.supplierId),
		]);
		const number = (kind === 'challan' ? doc.challanNumber : doc.number) ?? doc.id;
		const data = await this.print((brand, settings) => ({
			html: this.returnHtml(kind, doc, entry, supplier, settings, brand),
			title: `${kind === 'challan' ? 'Delivery challan' : 'Debit note'} ${number}`,
		}));
		return { fileName: `${number.replace(/\//g, '-')}.pdf`, data };
	}

	/* ------------------------------------------------------------ label sheets (l01) */

	labelsHtml(
		request: Pick<LabelSheetRequest, 'sheet' | 'startAt' | 'fields'>,
		labels: ReadonlyArray<{
			sku: string;
			name: string;
			priceINR: number | null;
			mrpINR: number | null;
			metre: boolean;
		}>,
	): string {
		const geometry = LABEL_SHEETS[request.sheet];
		const slots = labelSlots(request.sheet, request.startAt, labels.length);
		const show = new Set<LabelField>(request.fields);
		const pages = sheetsNeeded(request.sheet, request.startAt, labels.length);
		const sized = (mm: number) => `${mm}mm`;
		const bySheet: string[][] = Array.from({ length: pages }, () => []);
		labels.forEach((label, index) => {
			const slot = slots[index];
			if (!slot) return;
			const bars =
				show.has('barcode') && code128Encodable(label.sku)
					? (() => {
							const { bars: rects, modules } = code128Bars(label.sku);
							// Ten modules of quiet zone each side, so scanners find the code.
							const width = modules + 20;
							return `<svg class="bars" viewBox="0 0 ${width} 30" preserveAspectRatio="none" aria-hidden="true">${rects.map((bar) => `<rect x="${bar.x + 10}" y="0" width="${bar.width}" height="30"/>`).join('')}</svg>`;
						})()
					: '';
			const price =
				show.has('price') && label.priceINR !== null
					? `<strong>${escapeHtml(formatRupees(label.priceINR))}${label.metre ? ' / m' : ''}</strong>`
					: '';
			const mrp =
				show.has('mrp') && label.mrpINR !== null ? ` <s>MRP ${escapeHtml(formatRupees(label.mrpINR))}</s>` : '';
			bySheet[slot.sheet]?.push(
				`<div class="label" style="top:${sized(slot.yMm)};left:${sized(slot.xMm)};width:${sized(geometry.widthMm)};height:${sized(geometry.heightMm)}">${show.has('name') ? `<div class="name">${escapeHtml(label.name)}</div>` : ''}${bars}<div class="foot">${show.has('sku') ? `<span>${escapeHtml(label.sku)}</span>` : '<span></span>'}<span>${price}${mrp}</span></div></div>`,
			);
		});
		const sheets = bySheet.map((own) => `<section class="sheet">${own.join('')}</section>`).join('');
		return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Barcode labels</title><style>
@font-face{font-family:'Public Sans';src:url('fonts/public-sans-normal-100-900-latin.woff2') format('woff2');font-weight:100 900}
@font-face{font-family:'Noto Sans Bengali';src:url('fonts/noto-sans-bengali-normal-400-600-bengali.woff2') format('woff2');font-weight:400 600}
@page{size:A4;margin:0}
html,body{margin:0;padding:0}
body{font-family:'Public Sans','Noto Sans Bengali',sans-serif;color:#000}
.sheet{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always;break-after:page}
.sheet:last-child{page-break-after:auto;break-after:auto}
.label{position:absolute;box-sizing:border-box;padding:1.2mm 1.6mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;font-size:6.5pt;line-height:1.15}
.name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bars{display:block;width:100%;flex:1 1 auto;min-height:5mm;max-height:12mm;margin:0.6mm 0}
.bars rect{fill:#000}
.foot{display:flex;justify-content:space-between;gap:1mm;white-space:nowrap}
s{color:#444}
</style></head><body>${sheets}</body></html>`;
	}

	async labelsPdf(
		body: LabelSheetRequest,
		actor: string | null,
	): Promise<{ fileName: string; data: Uint8Array; count: number }> {
		const facts = await this.stock.items(body.items.map((item) => item.variantId));
		const labels: Array<{
			sku: string;
			name: string;
			priceINR: number | null;
			mrpINR: number | null;
			metre: boolean;
		}> = [];
		for (const item of body.items) {
			const fact = facts.get(item.variantId);
			if (!fact)
				throw refuse('unknown_item', 'An item on the sheet is no longer in the catalogue.', item.variantId);
			const name = [fact.title['en'] ?? Object.values(fact.title)[0] ?? fact.sku, fact.optionsLabel]
				.filter(Boolean)
				.join(' · ');
			for (let i = 0; i < item.count; i += 1) {
				labels.push({
					sku: fact.sku,
					name,
					priceINR: fact.sellingPriceINR,
					mrpINR: fact.mrpINR,
					metre: fact.soldBy === 'metre',
				});
			}
		}
		if (labels.length > MAX_LABELS)
			throw refuse('too_many_labels', `One print holds at most ${MAX_LABELS} labels.`);
		if (!this.renderer) throw refuse('pdf_unavailable', 'PDFs cannot be made on this server yet.');
		const assets = await this.orderDocument.loadStatic();
		const data = await this.renderer.renderPdf({
			html: this.labelsHtml(body, labels),
			assets: assets.filter((asset) => asset.path.startsWith('fonts/')),
			title: 'Barcode labels',
			author: 'Purchases and stock',
			page: { size: 'A4', landscape: false, marginMm: { top: 0, right: 0, bottom: 0, left: 0 } },
		});
		if (body.purchaseEntryId) {
			const entry = await this.entries.findById(body.purchaseEntryId);
			if (entry) {
				await this.support.record({
					actor,
					action: 'purchase.entry.labels',
					entityType: 'purchase_entry',
					entityId: entry.id,
					text: `${await this.support.nameOf(actor)} printed ${labels.length} barcode label${labels.length === 1 ? '' : 's'}.`,
				});
			}
		}
		return { fileName: `barcode-labels-${labels.length}.pdf`, data, count: labels.length };
	}
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Injectable, Logger, Optional } from '@nestjs/common';
import type { InventorySettings, PurchaseOrder, Supplier } from '@saha-textile/contracts';
import {
	type DocumentAsset,
	type DocumentRenderRequest,
	billedUnits,
	formatQuantity,
	formatRupees,
} from '@saha-textile/core-domain';

import { BrandService } from '../media/brand.service';

/** Where the document stylesheet and fonts live: `apps/api/assets/documents` (shipped with the API). */
const ASSET_DIRECTORY = resolve(process.cwd(), 'assets', 'documents');

const FONT_FILES = [
	'fonts/public-sans-normal-100-900-latin.woff2',
	'fonts/public-sans-normal-100-900-latin-ext.woff2',
	'fonts/noto-sans-bengali-normal-400-600-bengali.woff2',
];

/** Escapes text for HTML: every value on a document is data, never markup. */
export function escapeHtml(value: string | number | null | undefined): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const longDate = (day: string): string =>
	new Date(`${day}T12:00:00+05:30`).toLocaleDateString('en-IN', {
		timeZone: 'Asia/Kolkata',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});

/** A theme colour is only ever a 3- or 6-digit hex, so it can sit in a style attribute. */
const safeColour = (value: string | undefined): string | null =>
	value && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) ? value : null;

/**
 * The purchase order as a document (po05): the vendor's own invoice template (`theme-invoice-1`),
 * the Brand Kit logo, the supplier and the lines with agreed prices before GST. The supplier adds
 * GST on their bill.
 */
@Injectable()
export class PurchaseOrderDocument {
	private readonly logger = new Logger(PurchaseOrderDocument.name);
	private staticAssets: Promise<DocumentAsset[]> | null = null;

	constructor(@Optional() private readonly brand: BrandService | null = null) {}

	/** The stylesheet and fonts, read once per process. */
	private loadStatic(): Promise<DocumentAsset[]> {
		this.staticAssets ??= Promise.all([
			readFile(resolve(ASSET_DIRECTORY, 'invoice-1.css')).then((data) => ({
				path: 'invoice-1.css',
				contentType: 'text/css',
				data: new Uint8Array(data),
			})),
			...FONT_FILES.map((path) =>
				readFile(resolve(ASSET_DIRECTORY, path)).then((data) => ({
					path,
					contentType: 'font/woff2',
					data: new Uint8Array(data),
				})),
			),
		]).catch((error: unknown) => {
			this.staticAssets = null;
			throw error;
		});
		return this.staticAssets;
	}

	/** The Brand Kit logo's bytes, fetched here because the renderer itself never reaches the network. */
	private async logo(): Promise<{ asset: DocumentAsset | null; shopName: string; themeColor: string | null }> {
		const brand = await this.brand?.storefront().catch(() => null);
		const shopName = brand?.shopName || 'Saha Textile';
		const themeColor = safeColour(brand?.adminThemeColor) ?? safeColour(brand?.themeColor);
		const url = brand?.logo?.url;
		if (!url) return { asset: null, shopName, themeColor };
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
			if (!response.ok) throw new Error(`logo ${response.status}`);
			const contentType = response.headers.get('content-type') ?? 'image/webp';
			if (!contentType.startsWith('image/')) throw new Error('logo is not an image');
			return {
				asset: { path: 'logo', contentType, data: new Uint8Array(await response.arrayBuffer()) },
				shopName,
				themeColor,
			};
		} catch (error) {
			// A document without its logo is still a correct document: the shop's name is printed instead.
			this.logger.warn(`Brand logo not available for a document: ${(error as Error).message}`);
			return { asset: null, shopName, themeColor };
		}
	}

	html(
		order: PurchaseOrder,
		supplier: Supplier | null,
		settings: InventorySettings,
		brand: { hasLogo: boolean; shopName: string; themeColor: string | null },
	): string {
		const business = settings.business;
		const ourName = business.legalName || brand.shopName;
		const ours = [
			`<li><strong>${escapeHtml(ourName)}</strong></li>`,
			...business.addressLines.filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`),
			business.gstin ? `<li>GSTIN ${escapeHtml(business.gstin)}</li>` : '',
		].join('');
		const theirs = [
			`<li class="theme-color">To : <span class="text-content">${escapeHtml(order.supplierName)}</span></li>`,
			supplier?.gstin
				? `<li class="theme-color">GSTIN : <span class="text-content">${escapeHtml(supplier.gstin)}</span></li>`
				: '',
			supplier?.email
				? `<li class="theme-color">Email : <span class="text-content">${escapeHtml(supplier.email)}</span></li>`
				: '',
			supplier?.phone
				? `<li class="theme-color">Phone : <span class="text-content">${escapeHtml(supplier.phone)}</span></li>`
				: '',
		].join('');
		const rows = order.lines
			.map((line, index) => {
				const amount = Math.round(billedUnits(line.quantity, line.soldBy) * line.agreedPriceINR * 100) / 100;
				const detail = [
					line.sku,
					line.supplierItemCode ? `your code ${line.supplierItemCode}` : '',
					line.soldBy === 'metre' ? 'by the metre' : '',
				]
					.filter(Boolean)
					.join(' · ');
				const name = [line.title, line.optionsLabel].filter(Boolean).join(', ');
				return `<tr><td class="text-content">${index + 1}</td><td><ul class="text-start item-detail"><li>${escapeHtml(name)}</li><li class="text-content">${escapeHtml(detail)}</li></ul></td><td>${escapeHtml(formatQuantity(line.quantity, line.soldBy))}</td><td>${escapeHtml(formatRupees(line.agreedPriceINR))}${line.soldBy === 'metre' ? ' / m' : ''}</td><td>${escapeHtml(formatRupees(amount))}</td></tr>`;
			})
			.join('');
		const header = brand.hasLogo
			? `<img src="logo" alt="${escapeHtml(brand.shopName)}">`
			: `<span class="shop-name">${escapeHtml(brand.shopName)}</span>`;
		const colour = brand.themeColor ? `<style>:root{--theme-color:${brand.themeColor}}</style>` : '';
		return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(`Purchase order ${order.number}`)}</title>
<link rel="stylesheet" href="invoice-1.css">${colour}</head>
<body><section class="theme-invoice-1"><div class="invoice-wrapper">
<div class="invoice-header"><div class="header-image">${header}</div><div class="header-content"><h3>Purchase order</h3></div></div>
<div class="invoice-body">
<div class="top-sec"><div class="details-box"><div class="address-box"><ul>${ours}</ul></div><div class="address-box"><ul>${theirs}</ul></div></div></div>
<div class="invoice-table"><table class="table"><thead><tr><th>Order no.</th><th>Ordered on</th><th>Needed by</th><th>Deliver to</th></tr></thead>
<tbody><tr><td>${escapeHtml(order.number)}</td><td>${escapeHtml(longDate(order.createdAt.slice(0, 10)))}</td><td>${escapeHtml(longDate(order.expectedBy))}</td><td>${escapeHtml(order.deliverTo)}</td></tr></tbody></table></div>
<div class="invoice-table-2"><table class="table"><thead><tr><th>No.</th><th class="text-start">Item</th><th>Qty</th><th>Agreed price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="price-box"><ul><li>EXPECTED TOTAL (BEFORE GST)</li><li class="theme-color">${escapeHtml(formatRupees(order.orderedValueINR))}</li></ul></div>
<p class="text-content mt-3 mb-0">${order.noteToSupplier ? `Note: ${escapeHtml(order.noteToSupplier)} ` : ''}Prices are before GST; GST as applicable on your bill.</p>
</div>
<div class="invoice-footer"><div class="signature-box"><h5>For ${escapeHtml(ourName)}</h5></div></div>
</div></section></body></html>`;
	}

	async render(
		order: PurchaseOrder,
		supplier: Supplier | null,
		settings: InventorySettings,
	): Promise<DocumentRenderRequest> {
		const [assets, logo] = await Promise.all([this.loadStatic(), this.logo()]);
		return {
			html: this.html(order, supplier, settings, {
				hasLogo: Boolean(logo.asset),
				shopName: logo.shopName,
				themeColor: logo.themeColor,
			}),
			assets: logo.asset ? [...assets, logo.asset] : assets,
			title: `Purchase order ${order.number}`,
			author: settings.business.legalName || logo.shopName,
			page: { size: 'A4', landscape: false, marginMm: { top: 14, right: 12, bottom: 16, left: 12 } },
		};
	}
}

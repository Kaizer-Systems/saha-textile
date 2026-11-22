import type { DocumentBlock, DocumentPaper } from '@saha-textile/contracts';

import { escapeHtml } from '../purchasing/purchase-order-document';
import type { DocumentData, DocumentRow } from './document-data';

/**
 * A format + a document's data → one HTML page (bundle builder brief F, approved 2026-11-22). Blocks print in the
 * format's order; a hidden block prints nothing; a block shows only the fields the format chose. The same HTML feeds
 * the builder's live preview and, through the Chromium adapter, the PDF. Every value is escaped; scripts never run.
 */

/** Printed names of facts, parties, payment and note fields (documents print in English). */
export const FIELD_LABELS: Record<string, string> = {
	invoiceNo: 'Invoice no.',
	invoiceDate: 'Invoice date',
	orderNo: 'Order',
	orderDate: 'Order date',
	placeOfSupply: 'Place of supply',
	reverseCharge: 'Reverse charge',
	noteNo: 'Note no.',
	noteDate: 'Note date',
	originalInvoiceNo: 'Against invoice',
	originalInvoiceDate: 'Invoice date',
	receiptNo: 'Receipt no.',
	voucherNo: 'Voucher no.',
	date: 'Date',
	challanNo: 'Challan no.',
	purpose: 'Purpose',
	transport: 'Transport',
	parcelNo: 'Parcel',
	courier: 'Courier',
	awb: 'AWB',
	returnNo: 'Return no.',
	poNo: 'Purchase order',
	expectedBy: 'Needed by',
	entryNo: 'Entry no.',
	billNo: 'Supplier bill',
	billDate: 'Bill date',
	receivedOn: 'Received on',
	selfInvoiceNo: 'Self-invoice no.',
	against: 'Against',
	adjustmentNo: 'Adjustment no.',
	countNo: 'Count no.',
	area: 'Area',
	openingNo: 'Opening no.',
	irn: 'IRN',
	ackNo: 'Ack no.',
	ackDate: 'Ack date',
	ewayBill: 'E-way bill',
	copyLabel: 'Copy',
	payment: 'Payment',
	refundTo: 'Refund to',
	amount: 'Amount',
	method: 'Paid by',
	reference: 'Reference',
	taxOnAdvance: 'Tax on this advance',
	taxReversed: 'Tax reversed',
	rcmTax: 'Reverse-charge tax',
	refund: 'Refund',
	reason: 'Reason',
	noteToSupplier: 'Note to the supplier',
	rcmNote: 'Reverse charge',
	narration: 'Narration',
};

/** Column headings of the lines table. `tax` takes the document's own heading (CGST + SGST or IGST). */
export const COLUMN_LABELS: Record<string, string> = {
	index: '#',
	item: 'Item',
	hsn: 'HSN',
	qty: 'Qty',
	rate: 'Rate',
	discount: 'Discount',
	taxable: 'Taxable value',
	gstRate: 'GST',
	tax: 'Tax',
	amount: 'Amount',
	value: 'Value',
	check: '✓',
	cameWith: 'Came with',
	condition: 'Condition',
	supplierCode: 'Your code',
	ordered: 'Ordered',
	received: 'Received',
	before: 'Before',
	change: 'Change',
	after: 'After',
	expected: 'Expected',
	counted: 'Counted',
	difference: 'Difference',
	cost: 'Cost',
	account: 'Account',
	debit: 'Debit',
	credit: 'Credit',
};

/** Signature lines' captions. */
const SIGNATURE_LABELS: Record<string, string> = {
	signature: 'Authorised signatory',
	packedBy: 'Packed by',
	receivedBy: 'Received by',
	approvedBy: 'Approved by',
	countedBy: 'Counted by',
	checkedBy: 'Checked by',
	preparedBy: 'Prepared by',
};

/** Numeric columns line up on the right. */
const NUMERIC = new Set([
	'qty',
	'rate',
	'discount',
	'taxable',
	'gstRate',
	'tax',
	'amount',
	'value',
	'ordered',
	'received',
	'before',
	'change',
	'after',
	'expected',
	'counted',
	'difference',
	'cost',
	'debit',
	'credit',
]);

export interface RenderBrand {
	/** The logo as the HTML will load it: an asset path for the PDF, a data: address for the live preview. */
	logoSrc: string | null;
	themeColor: string | null;
	/** `@font-face` rules for the PDF (the preview uses the system's sans). */
	fontFaces: string;
}

const PAGE: Record<DocumentPaper, { size: string; margin: string; base: string }> = {
	a4: { size: 'A4', margin: '14mm 12mm 16mm', base: '9.5pt' },
	a5: { size: 'A5', margin: '10mm 9mm 12mm', base: '8pt' },
	roll80: { size: '80mm 297mm', margin: '4mm 4mm 6mm', base: '7.5pt' },
};

const e = escapeHtml;
const has = (block: DocumentBlock, field: string) => block.fields.includes(field);

function brandBlock(block: DocumentBlock, data: DocumentData, brand: RenderBrand, title: DocumentBlock | null): string {
	const logo =
		has(block, 'logo') && brand.logoSrc
			? `<img class="dz-logo" src="${e(brand.logoSrc)}" alt="${e(data.seller.name)}">`
			: '';
	const party = block.fields.some((f) => f !== 'logo')
		? `<div class="dz-seller"><b>${e(data.seller.name)}</b>${data.seller.lines.map((line) => `<div>${e(line)}</div>`).join('')}</div>`
		: '';
	const right = title ? titleBlock(title, data) : '';
	return `<header class="dz-head"><div class="dz-head-left">${logo}${party}</div>${right}</header>`;
}

function titleBlock(block: DocumentBlock, data: DocumentData): string {
	const copy =
		has(block, 'copyLabel') && data.values['copyLabel']
			? `<div class="dz-copy">${e(data.values['copyLabel'])}</div>`
			: '';
	return `<div class="dz-title"><h1>${e(data.title)}</h1>${copy}<div class="dz-number">${e(data.number)}</div><div class="dz-date">${e(data.date)}</div></div>`;
}

function factsGrid(fields: readonly string[], data: DocumentData, cls = 'dz-facts'): string {
	const cells = fields
		.filter((field) => data.values[field])
		.map(
			(field) =>
				`<div class="dz-fact"><span>${e(FIELD_LABELS[field] ?? field)}</span><b>${e(data.values[field])}</b></div>`,
		)
		.join('');
	return cells ? `<section class="${cls}">${cells}</section>` : '';
}

function partiesBlock(block: DocumentBlock, data: DocumentData): string {
	const boxes = block.fields
		.map((field) => data.parties[field])
		.filter((box): box is { heading: string; lines: string[] } => Boolean(box))
		.map(
			(box) =>
				`<div class="dz-box"><span class="dz-label">${e(box.heading)}</span>${box.lines.map((line, at) => (at === 0 ? `<b>${e(line)}</b>` : `<div>${e(line)}</div>`)).join('')}</div>`,
		)
		.join('');
	return boxes ? `<section class="dz-parties">${boxes}</section>` : '';
}

function rowHtml(row: DocumentRow, columns: readonly string[], block: DocumentBlock): string {
	const sizes = block.sizes ?? {};
	const size =
		row.kind === 'set' ? sizes.heading : row.kind === 'free' ? sizes.free : row.depth > 0 ? sizes.piece : undefined;
	const style = size ? ` style="font-size:${size}pt"` : '';
	const tag =
		row.kind === 'set'
			? '<i class="dz-tag dz-tag-set">SET</i>'
			: row.kind === 'free'
				? '<i class="dz-tag dz-tag-free">FREE</i>'
				: row.kind === 'extra'
					? '<i class="dz-tag dz-tag-extra">EXTRA</i>'
					: '';
	const cells = columns
		.map((column) => {
			if (column === 'item') {
				const elbow = row.depth > 0 ? '<span class="dz-elbow">└</span>' : '';
				const sku = row.sku
					? `<div class="dz-sub">${e(row.sku)}${row.sub ? ` · ${e(row.sub)}` : ''}</div>`
					: row.sub
						? `<div class="dz-sub">${e(row.sub)}</div>`
						: '';
				return `<td class="dz-item dz-depth-${row.depth}">${elbow}<span>${e(row.cells['item'] ?? '')}${tag}${sku}</span></td>`;
			}
			if (column === 'check') return '<td class="dz-check"><span class="dz-tick"></span></td>';
			// A set's heading row carries no amount or tax (owner, brief F): only its name and number.
			if (row.kind === 'set' && column !== 'index') return '<td></td>';
			const value = e(row.cells[column] ?? '');
			const struck = column === 'rate' && row.struck ? `<div class="dz-struck">${e(row.struck)}</div>` : '';
			return `<td class="${NUMERIC.has(column) ? 'dz-num' : ''}">${value}${struck}</td>`;
		})
		.join('');
	return `<tr class="dz-row dz-${row.kind}"${style}>${cells}</tr>`;
}

function tableBlock(block: DocumentBlock, data: DocumentData): string {
	const columns = block.fields;
	if (!columns.length || !data.rows?.length) return '';
	const head = columns
		.map((column) => {
			const label =
				column === 'tax' ? (data.taxHeading ?? COLUMN_LABELS['tax']) : (COLUMN_LABELS[column] ?? column);
			return `<th class="${NUMERIC.has(column) ? 'dz-num' : ''}">${e(label)}</th>`;
		})
		.join('');
	return `<table class="dz-table"><thead><tr>${head}</tr></thead><tbody>${data.rows.map((row) => rowHtml(row, columns, block)).join('')}</tbody></table>`;
}

function hsnBlock(data: DocumentData): string {
	if (!data.hsnSummary?.length) return '';
	const rows = data.hsnSummary
		.map(
			(row) =>
				`<tr><td>${e(row.hsn)}</td><td class="dz-num">${e(row.taxable)}</td><td class="dz-num">${e(row.rate)}</td><td class="dz-num">${e(row.tax)}</td></tr>`,
		)
		.join('');
	return `<table class="dz-hsn"><thead><tr><th>HSN</th><th class="dz-num">Taxable</th><th class="dz-num">Rate</th><th class="dz-num">${e(data.taxHeading ?? 'Tax')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function totalsBlock(block: DocumentBlock, data: DocumentData): string {
	// The sums, then the round off, then the total itself, which closes the box.
	const sums = has(block, 'totals') ? (data.totals?.['totals'] ?? []) : [];
	const roundOff = has(block, 'roundOff') ? (data.totals?.['roundOff'] ?? []) : [];
	const rows = sums.length ? [...sums.slice(0, -1), ...roundOff, sums[sums.length - 1]!] : roundOff;
	if (!rows.length) return '';
	const last = rows.length - 1;
	return `<section class="dz-totals">${rows.map((row, at) => `<div class="${at === last ? 'dz-total' : ''}"><span>${e(row.label)}</span><b>${e(row.value)}</b></div>`).join('')}</section>`;
}

function labelledBox(heading: string, body: string): string {
	return `<section class="dz-box dz-note"><span class="dz-label">${e(heading)}</span><div>${body}</div></section>`;
}

function signatureBlock(block: DocumentBlock, data: DocumentData): string {
	const declaration =
		has(block, 'declaration') && data.signatures?.['declaration']
			? `<p class="dz-declaration">${e(data.signatures['declaration'])}</p>`
			: '<span></span>';
	const lines = block.fields
		.filter((field) => field !== 'declaration')
		.map((field) => {
			const who = data.signatures?.[field] ?? '';
			const top = field === 'signature' ? `<b>For ${e(data.seller.name)}</b>` : `<b>${e(who)}</b>`;
			return `<div class="dz-sign">${top}<div class="dz-sign-line"></div><span>${e(SIGNATURE_LABELS[field] ?? field)}</span></div>`;
		})
		.join('');
	return `<section class="dz-signature">${declaration}<div class="dz-signs">${lines}</div></section>`;
}

function blockHtml(
	block: DocumentBlock,
	data: DocumentData,
	brand: RenderBrand,
	formatName: string,
	title: DocumentBlock | null,
): string {
	switch (block.type) {
		case 'brand':
			return brandBlock(block, data, brand, title);
		case 'title':
			return titleBlock(block, data);
		case 'facts':
			return factsGrid(block.fields, data);
		case 'parties':
			return partiesBlock(block, data);
		case 'einvoice': {
			const facts = factsGrid(
				block.fields.filter((f) => f !== 'signedQr'),
				data,
				'dz-facts dz-facts-tight',
			);
			const qr = has(block, 'signedQr') && data.qrSvg ? `<div class="dz-qr">${data.qrSvg}</div>` : '';
			return facts || qr ? `<section class="dz-einvoice">${facts}${qr}</section>` : '';
		}
		case 'eway':
			return factsGrid(block.fields, data, 'dz-facts dz-facts-tight');
		case 'table':
			return tableBlock(block, data);
		case 'hsnSummary':
			return hsnBlock(data);
		case 'totals':
			return totalsBlock(block, data);
		case 'words':
			return data.values['amountInWords']
				? `<p class="dz-words">Amount in words: <b>${e(data.values['amountInWords'])}</b></p>`
				: '';
		case 'payment':
		case 'note': {
			const items = block.fields.filter((field) => data.values[field]);
			if (!items.length) return '';
			if (items.length === 1) return labelledBox(FIELD_LABELS[items[0]!] ?? items[0]!, e(data.values[items[0]!]));
			return factsGrid(items, data, 'dz-facts dz-facts-tight');
		}
		case 'text':
			return block.text ? labelledBox(block.heading || 'Note', e(block.text).replace(/\n/g, '<br>')) : '';
		case 'signature':
			return signatureBlock(block, data);
		case 'footer':
			return `<footer class="dz-foot"><span>This is a computer-generated document.</span>${has(block, 'formatName') ? `<span>${e(data.number)} · ${e(formatName)}</span>` : ''}</footer>`;
	}
}

/** The whole page: the format's paper, the brand colour, then each visible block in order. */
export function documentHtml(
	format: { name: string; paper: DocumentPaper; blocks: readonly DocumentBlock[] },
	data: DocumentData,
	brand: RenderBrand,
): string {
	const visible = format.blocks.filter((block) => !block.hidden);
	const page = PAGE[format.paper];
	const footer = visible.find((block) => block.type === 'footer');
	const pageNumbers =
		footer && has(footer, 'pageNumber')
			? '@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7pt;color:#777}'
			: '';
	// Pages after the first repeat a slim header (brief F: "the header repeated"): the document, its number, the shop.
	// Inside <style>: quotes and backslashes escaped for CSS, and "<" as a CSS escape so no text can close the element.
	const cssText = (value: string) =>
		value
			.replace(/[\\"]/g, '\\$&')
			.replace(/</g, '\\3c ')
			.replace(/[\r\n]+/g, ' ');
	const running = `@top-left{content:"${cssText(`${data.title} ${data.number}`)}";font-size:7.5pt;font-weight:700;color:#3e4c59}@top-right{content:"${cssText(data.seller.name)}";font-size:7.5pt;color:#7b8794}`;
	const colour = brand.themeColor ?? '#0e6b5c';
	const parts: string[] = [];
	for (let at = 0; at < visible.length; at += 1) {
		const block = visible[at]!;
		// A title right after the brand sits on its right, as drawn (F05); on its own it prints full width.
		const next = visible[at + 1];
		const title = block.type === 'brand' && next?.type === 'title' ? next : null;
		parts.push(blockHtml(block, data, brand, format.name, title));
		if (title) at += 1;
	}
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(`${data.title} ${data.number}`)}</title>
<style>${brand.fontFaces}
@page{size:${page.size};margin:${page.margin};${pageNumbers}${running}}
@page:first{@top-left{content:none}@top-right{content:none}}
@media screen{body{padding:${page.margin}}}
:root{--dz:${e(colour)}}
*{box-sizing:border-box}
body{margin:0;font-family:'Public Sans','Noto Sans Bengali',system-ui,sans-serif;font-size:${page.base};color:#1f2933;line-height:1.35}
.dz-paper-roll80 .dz-facts,.dz-paper-roll80 .dz-parties{grid-template-columns:1fr}
.dz-head{display:flex;justify-content:space-between;gap:12px;padding-bottom:8px;border-bottom:2px solid var(--dz);margin-bottom:8px}
.dz-head-left{display:flex;flex-direction:column;gap:4px;min-width:0}
.dz-logo{max-height:38px;max-width:180px;object-fit:contain;align-self:flex-start}
.dz-seller{font-size:.88em;color:#52606d}.dz-seller b{color:#1f2933;font-size:1.05em}
.dz-title{text-align:right;flex:none}.dz-title h1{margin:0;color:var(--dz);font-size:1.6em}
.dz-copy{display:inline-block;margin:3px 0;padding:1px 6px;border:1px solid #cbd2d9;border-radius:3px;font-size:.72em;letter-spacing:.06em;text-transform:uppercase;color:#52606d}
.dz-number{font-weight:700}.dz-date{color:#52606d;font-size:.9em}
.dz-facts{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #e4e7eb;border-radius:4px;margin:0 0 8px}
.dz-facts-tight{grid-template-columns:repeat(3,1fr)}
.dz-fact{padding:4px 6px;border-right:1px solid #e4e7eb}.dz-fact:last-child{border-right:0}
.dz-fact span,.dz-label{display:block;font-size:.72em;letter-spacing:.05em;text-transform:uppercase;color:#7b8794}
.dz-label{color:var(--dz);font-weight:700;margin-bottom:2px}
.dz-parties{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:0 0 8px}
.dz-box{border:1px solid #e4e7eb;border-radius:4px;padding:6px 8px;font-size:.92em}
.dz-einvoice{display:flex;gap:8px;align-items:flex-start;margin:0 0 8px}.dz-einvoice .dz-facts{flex:1;margin:0}
.dz-qr svg{width:70px;height:70px}
.dz-table,.dz-hsn{width:100%;border-collapse:collapse;margin:0 0 8px}
.dz-table thead{display:table-header-group}
.dz-table th,.dz-hsn th{background:#f0f4f8;font-size:.75em;letter-spacing:.04em;text-transform:uppercase;text-align:left;padding:4px 5px;color:#3e4c59}
.dz-table td,.dz-hsn td{padding:4px 5px;border-bottom:1px solid #eef2f6;vertical-align:top}
.dz-num{text-align:right;white-space:nowrap}
.dz-item{display:flex;gap:4px}.dz-depth-1{padding-left:16px!important}.dz-depth-2{padding-left:32px!important}
.dz-elbow{color:#9aa5b1}.dz-sub{font-size:.8em;color:#7b8794}
.dz-set td{background:#f8fafc;font-weight:700}
.dz-free td{color:#1e7b4a;font-style:italic}
.dz-struck{text-decoration:line-through;color:#9aa5b1;font-size:.85em}
.dz-tag{display:inline-block;margin-left:5px;padding:0 4px;border-radius:2px;font-size:.66em;font-style:normal;font-weight:700;letter-spacing:.05em;vertical-align:1px}
.dz-tag-set{background:#fde8ec;color:#b42343}.dz-tag-free{background:#e3f6ec;color:#1e7b4a}.dz-tag-extra{background:#e6f0fb;color:#1d5fa8}
.dz-check{width:22px}.dz-tick{display:inline-block;width:11px;height:11px;border:1.2px solid #52606d;border-radius:2px}
.dz-hsn{width:55%;font-size:.88em}
.dz-totals{margin:0 0 8px auto;width:45%;border:1px solid #e4e7eb;border-radius:4px;padding:6px 8px}
.dz-paper-roll80 .dz-totals,.dz-paper-roll80 .dz-hsn{width:100%}
.dz-paper-roll80 .dz-table{font-size:.86em}.dz-paper-roll80 .dz-table th,.dz-paper-roll80 .dz-table td{padding:3px 2px}
.dz-paper-roll80 .dz-sub,.dz-paper-roll80 .dz-elbow{display:none}.dz-paper-roll80 .dz-depth-1{padding-left:6px!important}.dz-paper-roll80 .dz-depth-2{padding-left:10px!important}
.dz-paper-roll80 .dz-head{flex-direction:column}.dz-paper-roll80 .dz-title{text-align:left}
.dz-totals div{display:flex;justify-content:space-between;padding:1px 0}
.dz-total{border-top:1px solid var(--dz);margin-top:4px;padding-top:4px!important;color:var(--dz);font-size:1.15em}
.dz-words{margin:0 0 8px}
.dz-note{margin:0 0 8px}
.dz-signature{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:16px 0 8px}
.dz-declaration{margin:0;max-width:55%;font-size:.85em;color:#52606d}
.dz-signs{display:flex;gap:18px}.dz-sign{text-align:center;min-width:120px}
.dz-sign-line{border-top:1px solid #9aa5b1;margin:28px 0 3px}.dz-sign span{font-size:.8em;color:#52606d}
.dz-foot{display:flex;justify-content:space-between;font-size:.75em;color:#7b8794;border-top:1px solid #e4e7eb;padding-top:4px;margin-top:8px}
</style></head><body class="dz-paper-${format.paper}">${parts.join('\n')}</body></html>`;
}

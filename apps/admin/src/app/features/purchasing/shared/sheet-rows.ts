import type { PurchaseImportRow } from '@saha-textile/contracts';

/**
 * Reading a supplier's spreadsheet saved as CSV (p13), and the downloadable template. Columns are
 * found by their heading, in any order: "SKU or their code", "Quantity", "Unit price", "HSN",
 * "GST %". Quantities of fabric sold by the metre are in metres (12.5).
 */

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes; a BOM is ignored. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const input = text.replace(/^﻿/, '');
	for (let i = 0; i < input.length; i += 1) {
		const char = input[i];
		if (quoted) {
			if (char === '"') {
				if (input[i + 1] === '"') {
					field += '"';
					i += 1;
				} else quoted = false;
			} else field += char;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === ',' || char === ';' || char === '\t') {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && input[i + 1] === '\n') i += 1;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += char;
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

type Column = 'code' | 'quantity' | 'price' | 'hsn' | 'gst';

const HEADINGS: ReadonlyArray<[Column, RegExp]> = [
	['code', /^(sku|code|item|their.?code|item.?code|sku.?or.?their.?code|design)/i],
	['quantity', /^(qty|quantity|pcs|pieces|metres|meters|mtr)/i],
	['price', /^(unit.?price|price|rate|cost)/i],
	['hsn', /^hsn/i],
	['gst', /^(gst|tax)/i],
];

/** Which column holds what, from the heading row; null when the sheet has no code or quantity column. */
export function findColumns(heading: readonly string[]): Partial<Record<Column, number>> | null {
	const found: Partial<Record<Column, number>> = {};
	heading.forEach((cell, index) => {
		const text = cell.trim();
		for (const [column, pattern] of HEADINGS) {
			if (found[column] === undefined && pattern.test(text)) {
				found[column] = index;
				break;
			}
		}
	});
	return found.code === undefined || found.quantity === undefined || found.price === undefined ? null : found;
}

const number = (text: string | undefined): number => {
	const cleaned = (text ?? '').replace(/[₹,%\s]/g, '');
	return cleaned === '' ? Number.NaN : Number(cleaned);
};

/** Sheet rows → import rows, numbered as the spreadsheet numbers them (the heading is row 1). */
export function importRows(table: readonly string[][]): { rows: PurchaseImportRow[]; problem: string | null } {
	const [heading, ...body] = table;
	if (!heading) return { rows: [], problem: 'import_empty' };
	const columns = findColumns(heading);
	if (!columns) return { rows: [], problem: 'import_columns_missing' };
	const rows: PurchaseImportRow[] = [];
	body.forEach((cells, index) => {
		const code = (cells[columns.code ?? 0] ?? '').trim();
		if (!code) return;
		const gst = columns.gst === undefined ? Number.NaN : number(cells[columns.gst]);
		const quantity = number(cells[columns.quantity ?? 0]);
		const price = number(cells[columns.price ?? 0]);
		rows.push({
			row: index + 2,
			code,
			// Unreadable numbers still go to the API, which names them as problems (JSON has no NaN).
			quantity: Number.isFinite(quantity) ? quantity : 0,
			unitPriceINR: Number.isFinite(price) ? price : -1,
			hsn: columns.hsn === undefined ? '' : (cells[columns.hsn] ?? '').trim(),
			gstRatePct: Number.isFinite(gst) ? gst : null,
		});
	});
	return { rows, problem: rows.length ? null : 'import_empty' };
}

/** The template's heading and one example row (UTF-8 with BOM, so Excel reads it right). */
export const IMPORT_TEMPLATE_HEADER = ['SKU or their code', 'Quantity', 'Unit price', 'HSN', 'GST %'] as const;
export const IMPORT_TEMPLATE_EXAMPLE = ['ST-BAN-0412', '6', '9200', '5007', '5'] as const;

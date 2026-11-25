import { ExportRequest } from '@saha-textile/contracts';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import { DocumentsModule } from '../src/documents/documents.module';
import {
	ExportsController,
	ExportsModule,
	ExportsService,
	exportCsv,
	exportHtml,
	exportXlsx,
	shownCell,
} from '../src/exports/exports.service';

/**
 * Exports at their edges (brief 25 EX1, EX2): no filters and no totals, a date that isn't one, a title Excel can't take
 * as a sheet name, cells whose kind doesn't match their column, an export with no one signed in, and the route's file.
 */

const request = (over: Partial<ExportRequest> = {}) =>
	ExportRequest.parse({
		format: 'xlsx',
		title: 'Stock: in/out? [March] * every location \\ all',
		fileName: 'stock-2027-03',
		columns: [
			{ key: 'sku', label: 'SKU' },
			{ key: 'day', label: 'Day', kind: 'date' },
			{ key: 'qty', label: 'Quantity', kind: 'number' },
		],
		rows: [
			{ sku: 'SAR-1', day: '2027-03-31', qty: 4 },
			// No day, and one written as words.
			{ sku: 'SAR-2', qty: 1 },
			{ sku: 'SAR-3', day: 'end of March', qty: 2 },
		],
		...over,
	});

describe('Excel without filters or totals', () => {
	it('names the sheet without the characters Excel forbids, cut to 31, and keeps a date it can’t read as written', async () => {
		const book = new ExcelJS.Workbook();
		await book.xlsx.load(new Uint8Array(await exportXlsx(request(), 'K.R. Marketing')).buffer);
		const sheet = book.worksheets[0] as ExcelJS.Worksheet;
		expect(sheet.name).toBe('Stock  in out   March    every ');
		expect(sheet.name).toHaveLength(31);
		// The company and title, a blank row, then the header straight away.
		expect(sheet.getRow(4).values).toEqual([undefined, 'SKU', 'Day', 'Quantity']);
		expect(sheet.getCell('B5').value).toBeInstanceOf(Date);
		expect(sheet.getCell('B6').value).toBeNull();
		expect(sheet.getCell('B7').value).toBe('end of March');
		// No totals row after the last.
		expect(sheet.rowCount).toBe(7);
		expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
	});
});

describe('CSV and PDF without totals', () => {
	it('ends with the last row', () => {
		const text = exportCsv(request({ format: 'csv' }));
		expect(text.trim().split('\n').at(-1)).toBe('SAR-3,end of March,2');
		const html = exportHtml(
			request({ format: 'pdf' }),
			'K.R. Marketing',
			'someone',
			new Date('2027-04-01T05:30:00Z'),
		);
		expect(html).not.toContain('class="t"');
		expect(html).toContain('<td class="">end of March</td>');
		expect(html).toContain('<p class="f"></p>');
		expect(html).toContain('Printed by someone at 2027-04-01 05:30 UTC');
	});
});

describe('a cell whose kind doesn’t match its column', () => {
	it('prints as written', () => {
		const column = (kind: 'text' | 'number' | 'money' | 'date') => ({ key: 'k', label: 'K', kind });
		expect(shownCell('nil', column('money'))).toBe('nil');
		expect(shownCell(20270331, column('date'))).toBe('20270331');
		expect(shownCell('a dozen', column('number'))).toBe('a dozen');
		expect(shownCell(7, column('text'))).toBe('7');
		expect(shownCell('', column('money'))).toBe('');
		expect(shownCell('31/03/2027', column('date'))).toBe('31/03/2027');
	});
});

describe('the exports service and its route', () => {
	it('writes Excel, and logs an accounts export with no one signed in as no one', async () => {
		const audit = { append: vi.fn(async () => undefined) };
		const seller = vi.fn(async () => ({ name: 'K.R. Marketing', lines: [] }));
		const service = new ExportsService({ seller } as never, { renderPdf: vi.fn() } as never, audit as never);
		const file = await service.file(request({ area: 'accounts' }), undefined, new Date('2027-04-01T05:30:00Z'));
		expect(seller).toHaveBeenCalledWith({ name: 'Saha Textile', lines: [] });
		expect(file).toMatchObject({
			fileName: 'stock-2027-03.xlsx',
			contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		});
		const book = new ExcelJS.Workbook();
		await book.xlsx.load(new Uint8Array(file.data).buffer);
		expect(book.worksheets[0]?.getCell('A1').value).toBe('K.R. Marketing');
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: null,
				entityId: 'stock-2027-03',
				createdAt: '2027-04-01T05:30:00.000Z',
				metadata: { title: request().title, format: 'xlsx', rows: 3, filters: '' },
			}),
		);
	});

	it('sends the file as an attachment that is never cached', async () => {
		const file = {
			fileName: 'stock-2027-03.csv',
			contentType: 'text/csv; charset=utf-8',
			data: new Uint8Array([65]),
		};
		const exports = { file: vi.fn(async () => file) };
		const sent: { headers: Record<string, string>; body?: unknown } = { headers: {} };
		const reply = {
			header(name: string, value: string) {
				sent.headers[name] = value;
				return reply;
			},
			send(body: unknown) {
				sent.body = body;
				return reply;
			},
		};
		const body = request({ format: 'csv' });
		const principal = { userId: 'adm_1' } as never;
		await new ExportsController(exports as never).file(body, reply as never, principal);
		expect(exports.file).toHaveBeenCalledWith(body, principal);
		expect(sent).toEqual({
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': 'attachment; filename="stock-2027-03.csv"',
				'Cache-Control': 'no-store',
			},
			body: Buffer.from([65]),
		});
		expect(Reflect.getMetadata('path', ExportsController)).toBe('admin/exports');
	});

	it('is wired as its own module on the documents module', () => {
		expect(Reflect.getMetadata('imports', ExportsModule)).toEqual([DocumentsModule]);
		expect(Reflect.getMetadata('controllers', ExportsModule)).toEqual([ExportsController]);
		expect(Reflect.getMetadata('providers', ExportsModule)).toEqual([ExportsService]);
	});
});

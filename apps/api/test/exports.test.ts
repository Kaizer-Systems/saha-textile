import { ExportRequest } from '@saha-textile/contracts';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import { ExportsService, exportCsv, exportHtml, exportXlsx, shownCell } from '../src/exports/exports.service';

/** Export any list or report as CSV, Excel or PDF (brief 25 EX1, EX2). */

const request = (over: Partial<ExportRequest> = {}) =>
	ExportRequest.parse({
		format: 'csv',
		title: 'Credit notes',
		fileName: 'credit-notes-2026-11',
		filters: [{ label: 'Period', value: 'This month' }],
		columns: [
			{ key: 'number', label: 'Number' },
			{ key: 'date', label: 'Date', kind: 'date' },
			{ key: 'customer', label: 'Customer' },
			{ key: 'total', label: 'Total', kind: 'money' },
		],
		rows: [
			{ number: 'CN/26-27/000007', date: '2026-11-24', customer: 'মৌ ঘোষ', total: 4680 },
			{ number: 'CN/26-27/000006', date: '2026-11-21', customer: 'Anita Roy', total: 2340 },
		],
		totals: { number: 'Total', total: 7020 },
		...over,
	});

describe('exports', () => {
	it('writes CSV with plain numbers, ISO dates and a byte-order mark for Bengali', () => {
		const text = exportCsv(request());
		expect(text.startsWith('﻿Number,Date,Customer,Total')).toBe(true);
		expect(text).toContain('CN/26-27/000007,2026-11-24,মৌ ঘোষ,4680');
		expect(text.trim().split('\n').at(-1)).toBe('Total,,,7020');
	});

	it('writes Excel with the title, filters, a frozen header, ₹ numbers, dates and bold totals', async () => {
		const book = new ExcelJS.Workbook();
		await book.xlsx.load(Buffer.from(await exportXlsx(request({ format: 'xlsx' }), 'K.R. Marketing')));
		const sheet = book.worksheets[0] as ExcelJS.Worksheet;
		expect(sheet.getCell('A1').value).toBe('K.R. Marketing');
		expect(sheet.getCell('A3').value).toBe('Period: This month');
		expect(sheet.getRow(5).values).toEqual([undefined, 'Number', 'Date', 'Customer', 'Total']);
		expect(sheet.getCell('D6').value).toBe(4680);
		expect(sheet.getColumn(4).numFmt).toBe('"₹"#,##,##0.00');
		expect(sheet.getCell('B6').value).toBeInstanceOf(Date);
		expect(sheet.getRow(8).font?.bold).toBe(true);
		expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 5 });
	});

	it('prints money, dates and blanks as a reader expects, and escapes everything', () => {
		const column = (kind: 'text' | 'number' | 'money' | 'date') => ({ key: 'k', label: 'K', kind });
		expect(shownCell(123456.5, column('money'))).toBe('₹1,23,456.50');
		expect(shownCell('2026-11-24', column('date'))).toBe('24 Nov 2026');
		expect(shownCell(12345, column('number'))).toBe('12,345');
		expect(shownCell(null, column('text'))).toBe('');
		const html = exportHtml(
			request({ title: '<b>x</b>' }),
			'K.R. Marketing',
			'adm_1',
			new Date('2026-11-25T10:00:00Z'),
		);
		expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
		expect(html).toContain('₹4,680.00');
		expect(html).toContain('class="t"');
	});

	it('renders PDF landscape past six columns and logs accounts exports', async () => {
		const renderer = { renderPdf: vi.fn(async () => new Uint8Array([1])) };
		const audit = { append: vi.fn(async () => undefined) };
		const service = new ExportsService(
			{ seller: async () => ({ name: 'K.R. Marketing', lines: [] }) } as never,
			renderer as never,
			audit as never,
		);
		const wide = request({
			format: 'pdf',
			area: 'accounts',
			columns: Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, kind: 'text' as const })),
		});
		const file = await service.file(wide, { userId: 'adm_1' } as never);
		expect(file).toMatchObject({ fileName: 'credit-notes-2026-11.pdf', contentType: 'application/pdf' });
		expect(renderer.renderPdf).toHaveBeenCalledWith(
			expect.objectContaining({ page: expect.objectContaining({ landscape: true }) }),
		);
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'accounts.export' }));
		const csv = await service.file(request(), undefined);
		expect(csv.contentType).toContain('text/csv');
		expect(audit.append).toHaveBeenCalledTimes(1);
	});
});

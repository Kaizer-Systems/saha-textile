import type { Employee, SalaryVersion } from '@saha-textile/contracts';
import { ourBlocks } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { documentHtml } from '../src/documents/document-html';
import { previewDocument } from '../src/documents/document-previews';
import { revisionLetterData } from '../src/documents/revision-letter';
import { SalaryRevisionsController, SalaryRevisionsService } from '../src/payroll/salary-revisions';

/**
 * Brief 26 SR2: the revision letter: each head a month before and after with the change, the month's gross and the
 * CTC a year, printed on the active "Revision letter" format; the PDF route for a saved revision.
 */

const brand = { logoSrc: null, themeColor: null, fontFaces: '' };
const seller = { name: 'Saha Textile', lines: ['Kolkata'] };
const at = '2026-11-26T06:00:00.000Z';
const status = (error: unknown) => (error as { status?: number }).status;
const code = (error: unknown) => (error as { response?: { message?: string } }).response?.message;

const BEFORE = { basic: 13_500, da: 1_350, hra: 5_400, conveyance: 1_600, special: 5_701, other: 0 };
const AFTER = { basic: 14_580, da: 1_458, hra: 5_832, conveyance: 1_600, special: 6_359, other: 0 };
const version = (from: string, structure: typeof BEFORE, ctcYearINR: number | null): SalaryVersion => ({
	from,
	structure,
	ctcYearINR,
	reason: '',
	decrease: false,
	acceptedBy: null,
	acceptedAt: at,
	arrearsPaidIn: null,
});
const person = (over: Partial<Employee> = {}) =>
	({
		id: 'emp_1',
		name: 'Priya Test',
		code: 'EMP-0007',
		designation: 'Sales',
		department: 'Store',
		locationId: 'loc_1',
		salaryHistory: [version('2025-04-01', BEFORE, 360_000), version('2026-12-01', AFTER, 388_800)],
		...over,
	}) as Employee;

describe('the revision letter data', () => {
	it('lists each head paid before or after, the gross and the CTC, with the change signed', () => {
		const data = revisionLetterData({
			seller,
			employee: person(),
			locationName: 'Gariahat store',
			before: BEFORE,
			version: version('2026-12-01', AFTER, 388_800),
			ctcYearBeforeINR: 360_000,
		});
		expect(data.doc).toBe('revisionLetter');
		expect(data.date).toBe('26 Nov 2026');
		expect(data.values).toMatchObject({
			effectiveFrom: '1 Dec 2026',
			letterDate: '26 Nov 2026',
			employeeName: 'Priya Test',
			employeeCode: 'EMP-0007',
			location: 'Gariahat store',
		});
		const rows = data.payTables?.revision?.rows ?? [];
		// "Other" is nil before and after, so it is left out.
		expect(rows.map((r) => r.cells.head)).toEqual([
			'Basic',
			'Dearness allowance',
			'House rent allowance',
			'Conveyance',
			'Special allowance',
			'Gross a month',
			'CTC a year',
		]);
		expect(rows[0]?.cells).toEqual({
			head: 'Basic',
			before: '₹13,500.00',
			after: '₹14,580.00',
			change: '+₹1,080.00',
		});
		expect(rows[3]?.cells.change).toBe('₹0.00');
		expect(rows[5]).toMatchObject({ cells: { before: '₹27,551.00', after: '₹29,829.00' }, total: true });
		expect(rows[6]?.cells.change).toBe('+₹28,800.00');
	});

	it('signs a decrease with a minus and leaves out the CTC when either year has none', () => {
		const lower = { ...BEFORE, special: 5_201 };
		const data = revisionLetterData({
			seller,
			employee: person(),
			locationName: '',
			before: BEFORE,
			version: version('2026-12-01', lower, null),
			ctcYearBeforeINR: 360_000,
		});
		const rows = data.payTables?.revision?.rows ?? [];
		expect(rows.find((r) => r.cells.head === 'Special allowance')?.cells.change).toBe('−₹500.00');
		expect(rows.at(-1)?.cells.head).toBe('Gross a month');
		const noBefore = revisionLetterData({
			seller,
			employee: person(),
			locationName: '',
			before: BEFORE,
			version: version('2026-12-01', AFTER, 388_800),
			ctcYearBeforeINR: null,
		});
		expect(noBefore.payTables?.revision?.rows.at(-1)?.cells.head).toBe('Gross a month');
	});

	it('prints the table on our own format, with its title and columns', () => {
		const example = previewDocument('revisionLetter');
		const html = documentHtml(
			{ name: 'Revision letter', paper: 'a4', blocks: ourBlocks('revisionLetter') },
			example,
			brand,
		);
		expect(html).toContain('Your salary a month');
		expect(html).toContain('From the date above');
		expect(html).toContain('Priya Test');
		expect(html).toContain('CTC a year');
	});
});

describe('the revision letter PDF', () => {
	const service = (
		e: Employee | null,
		formats: { seller: unknown; renderActive: unknown } | null = {
			seller: vi.fn(async (fallback: unknown) => fallback),
			renderActive: vi.fn(async () => new Uint8Array([1, 2])),
		},
		locations = [{ id: 'loc_1', name: 'Gariahat store' }],
	) =>
		new SalaryRevisionsService(
			{ get: async () => e, save: vi.fn() } as never,
			{ get: vi.fn() } as never,
			{ forMonth: vi.fn() } as never,
			{ list: vi.fn() } as never,
			{ list: async () => locations } as never,
			{ append: vi.fn() } as never,
			formats as never,
		);

	it('renders the saved revision against the salary before it, on the active format', async () => {
		const formats = {
			seller: vi.fn(async (fallback: unknown) => fallback),
			renderActive: vi.fn(async () => new Uint8Array([1, 2])),
		};
		const file = await service(person(), formats).letterPdf('emp_1', '2026-12-01');
		expect(file.fileName).toBe('revision-letter-2026-12-01-Priya-Test.pdf');
		expect([...file.data]).toEqual([1, 2]);
		const [doc, data] = formats.renderActive.mock.calls[0] as unknown as [
			string,
			ReturnType<typeof revisionLetterData>,
		];
		expect(doc).toBe('revisionLetter');
		expect(data.values.location).toBe('Gariahat store');
		expect(data.payTables?.revision?.rows.at(-1)?.cells.before).toBe('₹3,60,000.00');
	});

	it('leaves the store out when the location is gone', async () => {
		const formats = {
			seller: vi.fn(async (fallback: unknown) => fallback),
			renderActive: vi.fn(async () => new Uint8Array([1])),
		};
		await service(person(), formats, []).letterPdf('emp_1', '2026-12-01');
		const [, data] = formats.renderActive.mock.calls[0] as unknown as [
			string,
			ReturnType<typeof revisionLetterData>,
		];
		expect(data.values.location).toBe('');
	});

	it('refuses a day with no revision, the first salary, a person with no history and a missing renderer', async () => {
		for (const [e, from, formats] of [
			[person(), '2026-01-01', undefined],
			[person(), '2025-04-01', undefined],
			[person({ salaryHistory: undefined }), '2026-12-01', undefined],
			[person(), '2026-12-01', null],
		] as const) {
			const error = await service(e, formats as never)
				.letterPdf('emp_1', from)
				.catch((x: unknown) => x);
			expect(status(error)).toBe(404);
			expect(code(error)).toBe('revision_letter_not_found');
		}
	});

	it('refuses an unknown person', async () => {
		const error = await service(null)
			.letterPdf('emp_x', '2026-12-01')
			.catch((x: unknown) => x);
		expect(status(error)).toBe(404);
	});

	it('sends the PDF from the route as a download', async () => {
		const reply = { header: vi.fn(() => reply), send: vi.fn() };
		const controller = new SalaryRevisionsController({
			letterPdf: async () => ({ fileName: 'revision-letter.pdf', data: new Uint8Array([7]) }),
		} as never);
		await controller.letter('emp_1', '2026-12-01', reply as never);
		expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/pdf');
		expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="revision-letter.pdf"');
		expect(reply.send).toHaveBeenCalledWith(Buffer.from([7]));
	});
});

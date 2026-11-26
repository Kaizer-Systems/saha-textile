import type { DocumentBlock, DocumentKind } from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import {
	checkFormatBlocks,
	DOCUMENT_SPECS,
	documentSpec,
	ourBlocks,
	seedDocumentFormats,
} from '../src/documents/index';
import { isGstDocument, renderSeriesNumber, seriesKey } from '../src/orders/numbering';

/**
 * The payslip as a document (brief 25 PS1–PS4): its spec, our format with the leave balance off, the Compact A5 seed
 * without the employer's share and the tax working, and its PS number.
 */

const KINDS = Object.keys(DOCUMENT_SPECS) as DocumentKind[];
const spec = DOCUMENT_SPECS.payslip;
const byType = (blocks: readonly DocumentBlock[], type: string) => blocks.find((b) => b.type === type);

describe('the payslip’s spec', () => {
	it('sits in the payroll group, kept outside GST, printed flat', () => {
		expect(spec).toMatchObject({ doc: 'payslip', group: 'payroll', gst: false });
		expect(documentSpec('payslip').tree).toBe(false);
	});

	it('offers the shared blocks and its own six, in print order', () => {
		expect(spec.blocks.map((b) => b.type)).toEqual([
			'brand',
			'title',
			'facts',
			'attendance',
			'earnings',
			'deductions',
			'words',
			'employerShare',
			'taxWorking',
			'leaveBalance',
			'text',
			'signature',
			'footer',
		]);
	});

	it('always prints the name, the month, this month’s earnings and deductions, and the net pay', () => {
		const required = spec.blocks.filter((b) => b.required).map((b) => [b.type, b.lockedFields]);
		expect(required).toEqual([
			['brand', []],
			['title', ['month']],
			['facts', ['employeeName']],
			['earnings', ['head', 'thisMonth']],
			['deductions', ['head', 'thisMonth']],
			['words', ['netPay']],
		]);
	});

	it('offers the date of birth and the leaving day but leaves them off our format, and zero heads only on request', () => {
		const facts = spec.blocks.find((b) => b.type === 'facts');
		expect(facts?.fields).toEqual(expect.arrayContaining(['dateOfBirth', 'leftOn']));
		expect(facts?.ours).not.toContain('dateOfBirth');
		expect(facts?.ours).not.toContain('leftOn');
		expect(byType(ourBlocks('payslip'), 'earnings')?.fields).toEqual([
			'head',
			'monthlyRate',
			'thisMonth',
			'yearToDate',
		]);
		expect(byType(ourBlocks('payslip'), 'deductions')?.fields).toEqual(['head', 'thisMonth', 'yearToDate']);
		expect(byType(ourBlocks('payslip'), 'signature')?.fields).toEqual(['computerMade']);
	});

	it('serves no block with our own fields or our hidden mark, for any document', () => {
		for (const doc of KINDS)
			for (const row of documentSpec(doc).blocks) {
				expect(row).not.toHaveProperty('ours');
				expect(row).not.toHaveProperty('hiddenInOurs');
			}
		expect(documentSpec('payslip').blocks.find((b) => b.type === 'leaveBalance')).toEqual({
			type: 'leaveBalance',
			fields: ['kind', 'taken'],
			lockedFields: [],
			required: false,
		});
	});
});

describe('our payslip formats', () => {
	it('carries the leave balance switched off in ours, and nothing else; no other document hides a block', () => {
		const ours = ourBlocks('payslip');
		expect(ours.filter((b) => b.hidden).map((b) => b.type)).toEqual(['leaveBalance']);
		for (const doc of KINDS.filter((kind) => kind !== 'payslip'))
			expect(ourBlocks(doc).some((b) => b.hidden)).toBe(false);
	});

	it('seeds the standard A4 switched on, and Compact A5 off without the employer’s share and the tax working', () => {
		const [standard, compact] = seedDocumentFormats().filter((row) => row.doc === 'payslip');
		expect(standard).toMatchObject({ paper: 'a4', active: true, seeded: true });
		expect(compact).toMatchObject({ name: 'Compact', paper: 'a5', active: false, seeded: true });
		expect(compact?.blocks.filter((b) => b.hidden).map((b) => b.type)).toEqual([
			'employerShare',
			'taxWorking',
			'leaveBalance',
		]);
		expect(compact?.blocks.map((b) => b.type)).toEqual(standard?.blocks.map((b) => b.type));
	});

	it('refuses a payslip that hides its earnings, drops this month or the net pay, or shows a field it does not have', () => {
		const ours = ourBlocks('payslip');
		const with_ = (type: string, change: Partial<DocumentBlock>) =>
			ours.map((b) => (b.type === type ? { ...b, ...change } : b));
		expect(checkFormatBlocks('payslip', with_('earnings', { hidden: true })).map((p) => p.code)).toEqual([
			'required_block_hidden',
		]);
		expect(checkFormatBlocks('payslip', with_('deductions', { fields: ['head'] })).map((p) => p.code)).toEqual([
			'locked_field_missing',
		]);
		expect(
			checkFormatBlocks(
				'payslip',
				ours.filter((b) => b.type !== 'words'),
			).map((p) => p.code),
		).toEqual(['required_block_missing']);
		expect(
			checkFormatBlocks('payslip', with_('employerShare', { fields: ['head', 'gstin'] })).map((p) => p.code),
		).toEqual(['field_not_allowed']);
		expect(checkFormatBlocks('payslip', with_('leaveBalance', { hidden: false }))).toEqual([]);
	});
});

describe('the payslip’s number', () => {
	const PS = { prefix: 'PS', separator: '/', includeFinancialYear: true, digits: 6, reset: 'fy' } as const;

	it('reads PS/26-27/000001, counted afresh each financial year, and is no GST document', () => {
		expect(renderSeriesNumber(PS, '2026-27', 1)).toBe('PS/26-27/000001');
		expect(seriesKey('payslip', PS, '2026-27')).toEqual({ series: 'doc:payslip', period: '2026-27' });
		expect(isGstDocument('payslip')).toBe(false);
	});
});

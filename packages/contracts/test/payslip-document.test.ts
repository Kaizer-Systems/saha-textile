import { describe, expect, it } from 'vitest';

import {
	DocumentBlock,
	DocumentBlockType,
	DocumentFormatCreate,
	DocumentGroup,
	DocumentKind,
	DocumentSpec,
} from '../src/document-formats';
import {
	DEFAULT_DOCUMENT_NUMBERING,
	DEFAULT_SERIES,
	DocumentNumberingSettings,
	GST_DOCUMENT_TYPES,
	NumberedDocumentType,
} from '../src/document-numbering';
import { EmployeeWrite, PayrollRow } from '../src/payroll';

/** The payslip as a document (brief 25 PS1–PS4): its kind, group, blocks, PS series, and the employee's new facts. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);

describe('the payslip among the documents', () => {
	it('is a document of its own in a payroll group', () => {
		expect(DocumentKind.options).toContain('payslip');
		expect(DocumentGroup.options).toEqual(['sales', 'parcels', 'purchases', 'stock', 'payroll']);
		expect(DocumentFormatCreate.parse({ doc: 'payslip', name: 'Payslip A5' })).toEqual({
			doc: 'payslip',
			from: 'ours',
			name: 'Payslip A5',
		});
	});

	it('has six blocks of its own beside the shared ones', () => {
		expect(DocumentBlockType.options.slice(-6)).toEqual([
			'attendance',
			'earnings',
			'deductions',
			'employerShare',
			'taxWorking',
			'leaveBalance',
		]);
		expect(DocumentBlock.parse({ id: 'earnings', type: 'earnings', fields: ['head', 'thisMonth'] })).toEqual({
			id: 'earnings',
			type: 'earnings',
			hidden: false,
			fields: ['head', 'thisMonth'],
			heading: '',
			text: '',
			sizes: {},
		});
		expect(DocumentBlock.parse({ id: 'leaveBalance', type: 'leaveBalance', hidden: true }).hidden).toBe(true);
		refused(DocumentBlock.safeParse({ id: 'leave', type: 'leave' }).success);
	});

	it('serves a payslip spec under payroll, outside GST', () => {
		const spec = {
			doc: 'payslip',
			group: 'payroll',
			gst: false,
			blocks: [{ type: 'taxWorking', fields: ['label', 'value'] }],
		};
		expect(DocumentSpec.parse(spec)).toEqual({
			...spec,
			tree: false,
			blocks: [{ type: 'taxWorking', fields: ['label', 'value'], lockedFields: [], required: false }],
		});
		refused(DocumentSpec.safeParse({ ...spec, group: 'salaries' }).success);
	});
});

describe('the payslip’s number', () => {
	it('runs a PS series by financial year, six digits, and is no GST document', () => {
		expect(NumberedDocumentType.options).toContain('payslip');
		expect(DEFAULT_SERIES.payslip).toEqual({
			prefix: 'PS',
			separator: '/',
			includeFinancialYear: true,
			digits: 6,
			reset: 'fy',
		});
		expect(GST_DOCUMENT_TYPES).not.toContain('payslip');
		expect(DEFAULT_DOCUMENT_NUMBERING.series.payslip).toBe(DEFAULT_SERIES.payslip);
		expect(DocumentNumberingSettings.parse(DEFAULT_DOCUMENT_NUMBERING).series.payslip.prefix).toBe('PS');
	});
});

describe('the employee and the run for a payslip', () => {
	const employee = {
		name: 'Priya Das',
		locationId: 'loc_kolkata',
		joinedOn: '2025-06-01',
		structure: { basic: 9_000, special: 9_000 },
	};

	it('prints a designation and a department, trimmed, up to 80 letters, none until given', () => {
		const filled = EmployeeWrite.parse({
			...employee,
			designation: ' Sales assistant ',
			department: ' Shop floor ',
		});
		expect([filled.designation, filled.department]).toEqual(['Sales assistant', 'Shop floor']);
		expect([EmployeeWrite.parse(employee).designation, EmployeeWrite.parse(employee).department]).toEqual(['', '']);
		accepted(EmployeeWrite.safeParse({ ...employee, designation: 'x'.repeat(80) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, designation: 'x'.repeat(81) }).success);
		refused(EmployeeWrite.safeParse({ ...employee, department: 'x'.repeat(81) }).success);
	});

	it('keeps a paid run’s payslip number on the row, none before', () => {
		const row = {
			employeeId: 'emp_1',
			name: 'Priya Das',
			locationId: 'loc_kolkata',
			paidDays: 30,
			grossPaise: 1_800_000,
			pfWagesPaise: 900_000,
			pfEmployeePaise: 108_000,
			pfEmployerPaise: 108_000,
			epsPaise: 75_000,
			esiEmployeePaise: 13_500,
			esiEmployerPaise: 58_500,
			ptPaise: 13_000,
			tdsPaise: 0,
			advancePaise: 0,
			netPaise: 1_665_500,
		};
		expect(PayrollRow.parse({ ...row, payslipNo: 'PS/26-27/000001' }).payslipNo).toBe('PS/26-27/000001');
		expect(PayrollRow.parse(row)).not.toHaveProperty('payslipNo');
		refused(PayrollRow.safeParse({ ...row, payslipNo: 1 }).success);
	});
});

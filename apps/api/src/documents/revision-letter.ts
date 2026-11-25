import type { Employee, SalaryVersion } from '@saha-textile/contracts';
import { SALARY_HEADS } from '@saha-textile/core-domain';

import type { DocumentData } from './document-data';

/**
 * The salary revision letter (brief 26 SR2; approved 2026-11-26): who, from when, and each head a month now and from
 * the new date, with the change and the CTC; printed on the active "Revision letter" format (Settings › Document
 * formats), whose text block holds the letter's own words.
 */
export interface RevisionLetterInput {
	seller: DocumentData['seller'];
	employee: Pick<Employee, 'name' | 'code' | 'designation' | 'department'>;
	locationName: string;
	before: Employee['structure'];
	version: Pick<SalaryVersion, 'from' | 'structure' | 'ctcYearINR' | 'acceptedAt'>;
	ctcYearBeforeINR: number | null;
}

const HEAD_NAMES: Record<string, string> = {
	basic: 'Basic',
	da: 'Dearness allowance',
	hra: 'House rent allowance',
	conveyance: 'Conveyance',
	special: 'Special allowance',
	other: 'Other allowance',
};
const money = (inr: number) =>
	`₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (inr: number) => `${inr > 0 ? '+' : inr < 0 ? '−' : ''}${money(Math.abs(inr))}`;
const day = (iso: string) =>
	new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC',
	});

export function revisionLetterData(input: RevisionLetterInput): DocumentData {
	const { before, version } = input;
	const total = (s: Employee['structure']) => SALARY_HEADS.reduce((sum, h) => sum + s[h], 0);
	const rows = SALARY_HEADS.filter((h) => before[h] || version.structure[h]).map((h) => ({
		cells: {
			head: HEAD_NAMES[h] as string,
			before: money(before[h]),
			after: money(version.structure[h]),
			change: signed(version.structure[h] - before[h]),
		},
	}));
	const ctc =
		version.ctcYearINR !== null && input.ctcYearBeforeINR !== null
			? [
					{
						cells: {
							head: 'CTC a year',
							before: money(input.ctcYearBeforeINR),
							after: money(version.ctcYearINR),
							change: signed(version.ctcYearINR - input.ctcYearBeforeINR),
						},
						total: true,
					},
				]
			: [];
	return {
		doc: 'revisionLetter',
		title: 'Salary revision',
		number: '',
		date: day(version.acceptedAt),
		seller: input.seller,
		values: {
			effectiveFrom: day(version.from),
			letterDate: day(version.acceptedAt),
			employeeName: input.employee.name,
			employeeCode: input.employee.code,
			designation: input.employee.designation,
			department: input.employee.department,
			location: input.locationName,
		},
		parties: {},
		payTables: {
			revision: {
				rows: [
					...rows,
					{
						cells: {
							head: 'Gross a month',
							before: money(total(before)),
							after: money(total(version.structure)),
							change: signed(total(version.structure) - total(before)),
						},
						total: true,
					},
					...ctc,
				],
			},
		},
	} as DocumentData;
}

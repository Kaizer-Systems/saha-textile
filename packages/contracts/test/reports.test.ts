import { describe, expect, it } from 'vitest';

import {
	FinancialStatement,
	PlByLocation,
	PlByLocationQuery,
	ReportCatalogue,
	ReportDataset,
	ReportDefinition,
	ReportDefinitionEdit,
	ReportDefinitionWrite,
	ReportFieldInfo,
	ReportFieldType,
	ReportFilter,
	ReportRun,
	ReportSpec,
	ReportTable,
	StatementKind,
	StatementQuery,
} from '../src/reports';

/** Reports (accounts brief U, V): the statements by location and the custom report builder. */

const accepted = (input: unknown) => expect(input).toBe(true);
const refused = (input: unknown) => expect(input).toBe(false);
const keys = (count: number) => Array.from({ length: count }, (_, at) => `field${at}`);

describe('the financial statements', () => {
	it('shows a balance sheet or a profit and loss, as at a day and at a location, or today everywhere', () => {
		expect(StatementKind.options).toEqual(['balanceSheet', 'profitLoss']);
		expect(StatementQuery.parse({})).toEqual({});
		expect(StatementQuery.parse({ asAt: '2027-03-31', locationId: 'loc_kolkata' })).toEqual({
			asAt: '2027-03-31',
			locationId: 'loc_kolkata',
		});
		refused(StatementQuery.safeParse({ asAt: '31-03-2027' }).success);
		refused(StatementQuery.safeParse({ locationId: '' }).success);
	});

	it('names the layout a statement came from', () => {
		const statement = {
			asAt: '2027-03-31',
			lastAsAt: null,
			rows: [
				{
					key: 'sales',
					label: 'Sales',
					depth: 0,
					side: 'credit',
					thisYearPaise: 10_000_000,
					lastYearPaise: null,
					ledgers: [],
				},
			],
			problems: [],
			code: 'RP-NCE-PL',
			name: 'Profit and loss',
			version: 1,
		};
		expect(FinancialStatement.parse(statement)).toEqual(statement);
		refused(FinancialStatement.safeParse({ ...statement, version: 1.5 }).success);
		refused(FinancialStatement.safeParse({ ...statement, code: undefined }).success);
	});

	it('sets profit and loss for a period side by side by location, in paise', () => {
		expect(PlByLocationQuery.parse({ from: '2026-04-01', to: '2027-03-31' })).toEqual({
			from: '2026-04-01',
			to: '2027-03-31',
		});
		refused(PlByLocationQuery.safeParse({ from: '2026-04-01' }).success);
		const pl = {
			from: '2026-04-01',
			to: '2027-03-31',
			code: 'RP-NCE-PL',
			name: 'Profit and loss',
			locations: [
				{ id: 'loc_kolkata', name: 'Kolkata' },
				{ id: 'loc_barasat', name: 'Barasat' },
			],
			rows: [
				{
					key: 'sales',
					label: 'Sales',
					depth: 0,
					side: 'credit',
					byLocation: { loc_kolkata: 7_000_000, loc_barasat: 3_000_000 },
					totalPaise: 10_000_000,
				},
			],
			problems: ['report_source_unknown:role:freight_in'],
		};
		expect(PlByLocation.parse(pl)).toEqual(pl);
		refused(PlByLocation.safeParse({ ...pl, rows: [{ ...pl.rows[0], depth: -1 }] }).success);
		refused(PlByLocation.safeParse({ ...pl, rows: [{ ...pl.rows[0], side: 'both' }] }).success);
		refused(PlByLocation.safeParse({ ...pl, rows: [{ ...pl.rows[0], byLocation: { loc_kolkata: 0.5 } }] }).success);
	});
});

describe('the custom report builder', () => {
	it('reports on ledger lines, invoice lines, invoices or the audit trail, in five kinds of field', () => {
		expect(ReportDataset.options).toEqual(['ledgerLines', 'invoiceLines', 'invoices', 'auditLines']);
		expect(ReportFieldType.options).toEqual(['text', 'number', 'money', 'date', 'percent']);
		const field = { key: 'taxable', type: 'money', summable: true };
		expect(ReportFieldInfo.parse(field)).toEqual(field);
		refused(ReportFieldInfo.safeParse({ ...field, type: 'boolean' }).success);
		const catalogue = { ledgerLines: [field], invoiceLines: [], invoices: [field], auditLines: [] };
		expect(ReportCatalogue.parse(catalogue)).toEqual(catalogue);
		refused(ReportCatalogue.safeParse({ ledgerLines: [], invoices: [] }).success);
		refused(ReportCatalogue.safeParse({ ledgerLines: [], invoiceLines: [], invoices: [] }).success);
	});

	it('filters a field by an operation and up to 50 values of up to 80 letters', () => {
		const filter = { field: ' buyer ', op: 'in', values: ['Ananya Sen'] };
		expect(ReportFilter.parse(filter)).toEqual({ ...filter, field: 'buyer' });
		for (const op of ['is', 'isNot', 'in', 'contains', 'gt', 'lt', 'between'])
			accepted(ReportFilter.safeParse({ ...filter, op }).success);
		refused(ReportFilter.safeParse({ ...filter, op: 'like' }).success);
		accepted(ReportFilter.safeParse({ ...filter, values: keys(50) }).success);
		refused(ReportFilter.safeParse({ ...filter, values: keys(51) }).success);
		refused(ReportFilter.safeParse({ ...filter, values: ['x'.repeat(81)] }).success);
		refused(ReportFilter.safeParse({ ...filter, field: '  ' }).success);
		refused(ReportFilter.safeParse({ ...filter, field: 'x'.repeat(41) }).success);
	});

	it('takes 1 to 20 columns, with no filters, groups, totals or sort unless chosen', () => {
		expect(ReportSpec.parse({ dataset: 'invoices', columns: ['document'] })).toEqual({
			dataset: 'invoices',
			columns: ['document'],
			filters: [],
			groupBy: [],
			totals: [],
			sort: null,
		});
		accepted(ReportSpec.safeParse({ dataset: 'invoices', columns: keys(20) }).success);
		refused(ReportSpec.safeParse({ dataset: 'invoices', columns: [] }).success);
		refused(ReportSpec.safeParse({ dataset: 'invoices', columns: keys(21) }).success);
		refused(ReportSpec.safeParse({ dataset: 'stock', columns: ['document'] }).success);
	});

	it('takes at most 10 filters, 3 groups and 12 totals, and a sort up or down', () => {
		const base = { dataset: 'invoices', columns: ['document'] };
		const filter = { field: 'buyer', op: 'is', values: ['x'] };
		accepted(ReportSpec.safeParse({ ...base, filters: Array.from({ length: 10 }, () => filter) }).success);
		refused(ReportSpec.safeParse({ ...base, filters: Array.from({ length: 11 }, () => filter) }).success);
		accepted(ReportSpec.safeParse({ ...base, groupBy: keys(3) }).success);
		refused(ReportSpec.safeParse({ ...base, groupBy: keys(4) }).success);
		accepted(ReportSpec.safeParse({ ...base, totals: keys(12) }).success);
		refused(ReportSpec.safeParse({ ...base, totals: keys(13) }).success);
		expect(ReportSpec.parse({ ...base, sort: { field: 'taxable', direction: 'desc' } }).sort).toEqual({
			field: 'taxable',
			direction: 'desc',
		});
		refused(ReportSpec.safeParse({ ...base, sort: { field: 'taxable', direction: 'up' } }).success);
	});

	it('runs a spec over a period, in full unless it is the preview', () => {
		const run = { spec: { dataset: 'invoices', columns: ['document'] }, from: '2026-11-01', to: '2026-11-30' };
		expect(ReportRun.parse(run).preview).toBe(false);
		expect(ReportRun.parse({ ...run, preview: true }).preview).toBe(true);
		refused(ReportRun.safeParse({ ...run, from: '1 Nov 2026' }).success);
		refused(ReportRun.safeParse({ ...run, spec: { dataset: 'invoices', columns: [] } }).success);
	});

	it('gives the table: typed columns, rows of text, numbers or empty, totals, the count and whether it was cut', () => {
		const table = {
			columns: [
				{ key: 'location', type: 'text' },
				{ key: 'taxable', type: 'money' },
			],
			rows: [
				['Kolkata', 400_000],
				[null, 0],
			],
			totals: [null, 400_000],
			count: 2,
			truncated: false,
		};
		expect(ReportTable.parse(table)).toEqual(table);
		refused(ReportTable.safeParse({ ...table, rows: [[true]] }).success);
		refused(ReportTable.safeParse({ ...table, totals: ['x'] }).success);
		refused(ReportTable.safeParse({ ...table, count: -1 }).success);
	});
});

describe('saved reports', () => {
	const write = {
		name: ' Margin by location ',
		spec: { dataset: 'invoices', columns: ['location', 'marginPercent'], groupBy: ['location'] },
		from: '2026-11-01',
		to: '2026-11-30',
	};

	it('saves the choices under “Saved by you”, for the person who saved it, with the days kept unless a period moves', () => {
		expect(ReportDefinitionWrite.parse(write)).toMatchObject({
			name: 'Margin by location',
			folder: 'Saved by you',
			periodPreset: null,
			openTo: 'me',
			roleIds: [],
		});
		expect(
			ReportDefinitionWrite.parse({
				...write,
				folder: ' Sales ',
				periodPreset: ' this_month ',
				openTo: 'roles',
				roleIds: ['role_accounts'],
			}),
		).toMatchObject({ folder: 'Sales', periodPreset: 'this_month', openTo: 'roles', roleIds: ['role_accounts'] });
	});

	it('refuses an empty or long name or folder, an unknown audience, more than 20 roles, or a long preset', () => {
		refused(ReportDefinitionWrite.safeParse({ ...write, name: '  ' }).success);
		refused(ReportDefinitionWrite.safeParse({ ...write, name: 'x'.repeat(81) }).success);
		refused(ReportDefinitionWrite.safeParse({ ...write, folder: '' }).success);
		refused(ReportDefinitionWrite.safeParse({ ...write, folder: 'x'.repeat(61) }).success);
		refused(ReportDefinitionWrite.safeParse({ ...write, openTo: 'public' }).success);
		accepted(ReportDefinitionWrite.safeParse({ ...write, roleIds: keys(20) }).success);
		refused(ReportDefinitionWrite.safeParse({ ...write, roleIds: keys(21) }).success);
		refused(ReportDefinitionWrite.safeParse({ ...write, periodPreset: 'x'.repeat(31) }).success);
	});

	it('keeps who saved it and when, and edits it at its version', () => {
		const saved = {
			...ReportDefinitionWrite.parse(write),
			id: 'rpt_1',
			createdBy: 'adm_1',
			createdByName: 'Accountant',
			createdAt: '2026-11-24T10:00:00.000Z',
			updatedAt: '2026-11-24T10:00:00.000Z',
			version: 0,
		};
		expect(ReportDefinition.parse(saved)).toEqual(saved);
		accepted(ReportDefinition.safeParse({ ...saved, createdBy: null }).success);
		refused(ReportDefinition.safeParse({ ...saved, version: -1 }).success);
		expect(ReportDefinitionEdit.parse({ ...write, version: 3 }).version).toBe(3);
		refused(ReportDefinitionEdit.safeParse(write).success);
	});
});

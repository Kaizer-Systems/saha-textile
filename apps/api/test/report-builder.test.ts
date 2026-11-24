import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ReportDefinition, ReportDefinitionWrite, ReportSpec } from '@saha-textile/contracts';
import { REPORT_DATASETS } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AccountsTemplatesModule } from '../src/accounts-templates/accounts-templates.module';
import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { LedgerModule } from '../src/ledger/ledger.module';
import { LocationsModule } from '../src/locations/locations.module';
import { BooksReportsService } from '../src/reports/books-reports.service';
import { ReportBuilderController } from '../src/reports/report-builder.controller';
import { PREVIEW_LIMIT, RUN_LIMIT, ReportBuilderService } from '../src/reports/report-builder.service';
import { ReportsModule } from '../src/reports/reports.module';
import { StatementsController } from '../src/reports/statements.controller';
import { StatementsService } from '../src/reports/statements.service';

/** The custom report builder and saved reports (accounts brief V1, V2). */

const at = '2026-11-28T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const person = (userId: string) => ({ userId, permissions: ['accounts.index'] }) as never;

const CHART = {
	groups: [{ id: 'g_sales', name: 'Sales accounts' }],
	ledgers: [
		{ id: 'led_sales', name: 'Sales', groupId: 'g_sales', roles: [] },
		// Its group isn't in the chart any more.
		{ id: 'led_cogs', name: 'Cost of goods sold', groupId: 'g_gone', roles: ['cost_of_goods_sold'] },
	],
};
const line = (ledgerId: string, locationId: string, debitPaise: number, creditPaise: number, narration = '') => ({
	ledgerId,
	locationId,
	debitPaise,
	creditPaise,
	narration,
});
const VOUCHERS = [
	{
		id: 'jv_inv',
		number: 'JV/26-27/000001',
		kind: 'journal',
		date: '2026-11-10',
		narration: 'Sale on invoice TI/1',
		source: { type: 'taxInvoice' },
		lines: [
			line('led_sales', 'loc_bar', 0, 100_000),
			line('led_cogs', 'loc_bar', 70_000, 0, 'Cost of the saree'),
			// Another GSTIN's location this person can't see.
			line('led_sales', 'loc_tr', 0, 9_999),
		],
	},
	{
		id: 'jv_old',
		number: 'JV/26-27/000002',
		kind: 'payment',
		date: '2026-11-12',
		narration: 'Rent',
		source: null,
		lines: [line('led_gone', 'loc_shop', 5_000, 0)],
	},
];

const party = (name: string, gstin: string | null) => ({ name, gstin, address: '', stateCode: '19' });
const docLine = (over: Record<string, unknown> = {}) => ({
	lineId: 'a',
	sku: 'BAN-3',
	title: 'Banarasi Silk Saree',
	hsn: '5007',
	quantity: 2,
	unit: 'PCS',
	unitPriceINR: 525,
	ratePercent: 5,
	taxableINR: 1000,
	cgstINR: 25,
	sgstINR: 25,
	igstINR: 0,
	totalINR: 1050,
	...over,
});
const doc = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	number: `TI/${id}`,
	date: '2026-11-10',
	gstin: '19DBYPS6736R1ZZ',
	locationId: 'loc_bar',
	orderNumber: `ST-${id}`,
	status: 'issued',
	buyer: party('Ananya Das', null),
	lines: [docLine()],
	taxableINR: 1000,
	cgstINR: 25,
	sgstINR: 25,
	igstINR: 0,
	totalINR: 1050,
	voucherId: null,
	...over,
});
const INVOICES: Record<string, unknown[]> = {
	'19DBYPS6736R1ZZ': [
		doc('i1', { voucherId: 'jv_inv' }),
		doc('i_cancelled', { status: 'cancelled' }),
		doc('i_hidden', { locationId: 'loc_tr' }),
	],
	'16ABCDE1234F1Z5': [
		doc('i2', { gstin: '16ABCDE1234F1Z5', locationId: 'loc_shop', buyer: party('Rang Mahal', '27AAKFR1234M1Z2') }),
	],
};
const NOTES: Record<string, unknown[]> = {
	'19DBYPS6736R1ZZ': [
		// Issued, but with no number on it: shown as no document number.
		doc('cn1', {
			number: null,
			lines: [docLine({ quantity: 1, taxableINR: 500, cgstINR: 12.5, sgstINR: 12.5, totalINR: 525 })],
			taxableINR: 500,
			cgstINR: 12.5,
			sgstINR: 12.5,
			totalINR: 525,
			voucherId: 'jv_missing',
		}),
		doc('cn_draft', { status: 'draft' }),
	],
	'16ABCDE1234F1Z5': [],
};

const definition = (id: string, over: Partial<ReportDefinition> = {}): ReportDefinition => ({
	id,
	name: `Report ${id}`,
	folder: 'Saved by you',
	spec: { dataset: 'invoices', columns: ['document'], filters: [], groupBy: [], totals: [], sort: null },
	periodPreset: null,
	from: '2026-11-01',
	to: '2026-11-30',
	openTo: 'me',
	roleIds: [],
	createdBy: 'adm_a',
	createdByName: 'Rina Das',
	createdAt: at,
	updatedAt: at,
	version: 0,
	...over,
});
const ADMINS: Record<string, unknown> = {
	adm_a: { displayName: 'Rina Das', email: 'rina@saha-textile.test', username: 'rina' },
	adm_e: { displayName: '', email: 'raju@saha-textile.test', username: 'raju' },
	adm_u: { displayName: null, email: null, username: 'sudip' },
	adm_blank: { displayName: '', email: '', username: '' },
};

function build(
	options: {
		pages?: { items: unknown[]; total: number }[];
		chart?: unknown;
		definitions?: ReportDefinition[];
		saveFails?: unknown;
	} = {},
) {
	const pages = options.pages ?? [{ items: VOUCHERS, total: 2 }];
	const books = {
		chart: async () => options.chart ?? CHART,
		listVouchers: vi.fn(async (query: { page: number }) => pages[query.page - 1] ?? { items: [], total: 0 }),
		getVoucher: async (id: string) => VOUCHERS.find((v) => v.id === id) ?? null,
	};
	const store = new Map((options.definitions ?? []).map((d) => [d.id, d]));
	const definitions = {
		list: async () => [...store.values()],
		get: async (id: string) => store.get(id) ?? null,
		insert: vi.fn(async (d: ReportDefinition) => void store.set(d.id, d)),
		save: vi.fn(async (d: ReportDefinition, expectedVersion: number) => {
			if (options.saveFails !== undefined) throw options.saveFails;
			if (store.get(d.id)?.version !== expectedVersion) throw new Error('report_definition_changed');
			const saved = { ...d, version: expectedVersion + 1 };
			store.set(d.id, saved);
			return saved;
		}),
		remove: vi.fn(async (id: string) => store.delete(id)),
	};
	const service = new ReportBuilderService(
		books as never,
		{ listRegistrations: async () => [{ gstin: '19DBYPS6736R1ZZ' }, { gstin: '16ABCDE1234F1Z5' }] } as never,
		{ listForGstin: async (gstin: string) => INVOICES[gstin] ?? [] } as never,
		{ listForGstin: async (gstin: string) => NOTES[gstin] ?? [] } as never,
		definitions as never,
		{ listActiveForUser: async (userId: string) => (userId === 'adm_c' ? [{ roleId: 'role_acc' }] : []) } as never,
		{
			findById: async (id: string) => {
				if (id === 'adm_down') throw new Error('people lookup down');
				return ADMINS[id] ?? null;
			},
		} as never,
		{
			list: async () => [
				{ id: 'loc_bar', name: 'Barasat' },
				{ id: 'loc_shop', name: 'Shop' },
			],
		} as never,
	);
	return { service, books, definitions, store };
}

const spec = (over: Partial<ReportSpec> & Pick<ReportSpec, 'dataset' | 'columns'>): ReportSpec => ({
	filters: [],
	groupBy: [],
	totals: [],
	sort: null,
	...over,
});
const runOf = (s: ReportSpec, preview = false) => ({ spec: s, from: '2026-11-01', to: '2026-11-30', preview });

describe('the kinds of data a report is made from (V1)', () => {
	it('lists every kind of data with its fields', () => {
		const catalogue = build().service.catalogue();
		expect(Object.keys(catalogue)).toEqual(Object.keys(REPORT_DATASETS));
		expect(catalogue.ledgerLines).toContainEqual({ key: 'net', type: 'money', summable: true });
		expect(catalogue.invoices).toContainEqual({ key: 'marginPercent', type: 'percent', summable: false });
	});
});

describe('running a report on ledger lines (V1)', () => {
	const columns = [
		'date',
		'voucher',
		'voucherKind',
		'source',
		'ledger',
		'group',
		'location',
		'narration',
		'debit',
		'credit',
		'net',
	];

	it('reads the lines at the locations this person may see, naming ledgers, groups and narrations', async () => {
		const { service, books } = build();
		const table = await service.run(
			runOf(spec({ dataset: 'ledgerLines', columns, totals: ['net'] })),
			person('adm_a'),
		);
		expect(books.listVouchers).toHaveBeenCalledWith(
			expect.objectContaining({ from: '2026-11-01', to: '2026-11-30', search: '', page: 1, pageSize: 500 }),
		);
		expect(table.rows).toEqual([
			[
				'2026-11-10',
				'JV/26-27/000001',
				'journal',
				'taxInvoice',
				'Sales',
				'Sales accounts',
				'Barasat',
				'Sale on invoice TI/1',
				0,
				100_000,
				-100_000,
			],
			[
				'2026-11-10',
				'JV/26-27/000001',
				'journal',
				'taxInvoice',
				'Cost of goods sold',
				'',
				'Barasat',
				'Cost of the saree',
				70_000,
				0,
				70_000,
			],
			// A ledger the chart no longer has shows its id and no group; a voucher with no source shows none.
			['2026-11-12', 'JV/26-27/000002', 'payment', '', 'led_gone', '', 'Shop', 'Rent', 5_000, 0, 5_000],
		]);
		expect(table.totals.at(-1)).toBe(-25_000);
	});

	it('reads page after page until every voucher is read, or a page comes back empty', async () => {
		const paged = build({
			pages: [
				{ items: VOUCHERS.slice(0, 1), total: 2 },
				{ items: VOUCHERS.slice(1), total: 2 },
			],
		});
		expect((await paged.service.run(runOf(spec({ dataset: 'ledgerLines', columns })), person('adm_a'))).count).toBe(
			3,
		);
		expect(paged.books.listVouchers).toHaveBeenCalledTimes(2);
		const short = build({ pages: [{ items: VOUCHERS.slice(0, 1), total: 9 }] });
		expect((await short.service.run(runOf(spec({ dataset: 'ledgerLines', columns })), person('adm_a'))).count).toBe(
			2,
		);
		expect(short.books.listVouchers).toHaveBeenCalledTimes(2);
	});

	it('refuses a period of more vouchers than it reads at once', async () => {
		const huge = build({ pages: [{ items: VOUCHERS, total: 20_001 }] });
		await expect(
			huge.service.run(runOf(spec({ dataset: 'ledgerLines', columns: ['net'] })), person('adm_a')),
		).rejects.toMatchObject(refusal('report_too_large'));
	});

	it('shows the first 50 rows in a preview and up to 5,000 in a run', async () => {
		const many = {
			...VOUCHERS[0],
			lines: Array.from({ length: 60 }, (_, i) => line('led_sales', 'loc_bar', 0, i + 1)),
		};
		const { service } = build({ pages: [{ items: [many], total: 1 }] });
		const preview = await service.run(
			runOf(spec({ dataset: 'ledgerLines', columns: ['net'] }), true),
			person('adm_a'),
		);
		expect([preview.rows.length, preview.count, preview.truncated]).toEqual([PREVIEW_LIMIT, 60, true]);
		const full = await service.run(runOf(spec({ dataset: 'ledgerLines', columns: ['net'] })), person('adm_a'));
		expect([full.rows.length, full.truncated]).toEqual([60, false]);
		expect(RUN_LIMIT).toBe(5_000);
	});

	it('refuses a period that ends before it starts, and a field the data doesn’t have', async () => {
		const { service } = build();
		const backwards = service.run(
			{ ...runOf(spec({ dataset: 'ledgerLines', columns: ['net'] })), from: '2026-12-01' },
			person('adm_a'),
		);
		await expect(backwards).rejects.toBeInstanceOf(BadRequestException);
		await expect(backwards).rejects.toMatchObject(refusal('report_period_backwards'));
		await expect(
			service.run(runOf(spec({ dataset: 'ledgerLines', columns: ['nope'] })), person('adm_a')),
		).rejects.toMatchObject(refusal('report_field_unknown:nope'));
	});
});

describe('running a report on sales documents (V1)', () => {
	it('lists each line of every GSTIN’s invoices and issued credit notes, a note taking back its quantity and money', async () => {
		const columns = [
			'document',
			'documentKind',
			'gstin',
			'location',
			'buyer',
			'buyerGstin',
			'product',
			'quantity',
			'taxable',
			'cgst',
			'igst',
			'tax',
			'total',
		];
		const table = await build().service.run(runOf(spec({ dataset: 'invoiceLines', columns })), person('adm_a'));
		expect(table.rows).toEqual([
			[
				'TI/i1',
				'invoice',
				'19DBYPS6736R1ZZ',
				'Barasat',
				'Ananya Das',
				'',
				'Banarasi Silk Saree',
				2,
				100_000,
				2_500,
				0,
				5_000,
				105_000,
			],
			[
				'TI/i2',
				'invoice',
				'16ABCDE1234F1Z5',
				'Shop',
				'Rang Mahal',
				'27AAKFR1234M1Z2',
				'Banarasi Silk Saree',
				2,
				100_000,
				2_500,
				0,
				5_000,
				105_000,
			],
			// A note's nothing of IGST is −1 × 0, which JSON sends as 0.
			[
				'',
				'creditNote',
				'19DBYPS6736R1ZZ',
				'Barasat',
				'Ananya Das',
				'',
				'Banarasi Silk Saree',
				-1,
				-50_000,
				-1_250,
				-0,
				-2_500,
				-52_500,
			],
		]);
	});

	it('gives each document its cost of goods from its posting and the margin on it', async () => {
		const columns = [
			'document',
			'documentKind',
			'order',
			'buyerGstin',
			'taxable',
			'tax',
			'total',
			'cost',
			'margin',
		];
		const table = await build().service.run(runOf(spec({ dataset: 'invoices', columns })), person('adm_a'));
		expect(table.rows).toEqual([
			// Cost from the invoice's voucher; none without a voucher, or when its voucher is gone.
			['TI/i1', 'invoice', 'ST-i1', '', 100_000, 5_000, 105_000, 70_000, 30_000],
			['TI/i2', 'invoice', 'ST-i2', '27AAKFR1234M1Z2', 100_000, 5_000, 105_000, 0, 100_000],
			['', 'creditNote', '', '', -50_000, -2_500, -52_500, 0, -50_000],
		]);
		const unmapped = build({ chart: { groups: [], ledgers: [] } });
		const costs = await unmapped.service.run(
			runOf(spec({ dataset: 'invoices', columns: ['document', 'cost'] })),
			person('adm_a'),
		);
		expect(costs.rows.map((row) => row[1])).toEqual([0, 0, 0]);
	});
});

describe('saved reports: who may open them (V2, U1)', () => {
	const saved = [
		definition('rpt_mine'),
		definition('rpt_theirs', { createdBy: 'adm_b' }),
		definition('rpt_all', { createdBy: 'adm_b', openTo: 'all' }),
		definition('rpt_roles', { createdBy: 'adm_b', openTo: 'roles', roleIds: ['role_acc'] }),
	];

	it('lists the maker’s own, those open to everyone, and those open to a role the person holds', async () => {
		const { service } = build({ definitions: saved });
		const ids = async (who: unknown) => (await service.list(who as never)).map((d) => d.id);
		expect(await ids(person('adm_a'))).toEqual(['rpt_mine', 'rpt_all']);
		expect(await ids(person('adm_c'))).toEqual(['rpt_all', 'rpt_roles']);
		expect(await ids(undefined)).toEqual([]);
	});

	it('opens a report the person may open, and refuses one that doesn’t exist or isn’t theirs', async () => {
		const { service } = build({ definitions: saved });
		expect((await service.get('rpt_roles', person('adm_c'))).id).toBe('rpt_roles');
		const missing = service.get('rpt_gone', person('adm_a'));
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('report_definition_not_found'));
		const theirs = service.get('rpt_theirs', person('adm_a'));
		await expect(theirs).rejects.toBeInstanceOf(ForbiddenException);
		await expect(theirs).rejects.toMatchObject(refusal('report_definition_not_yours'));
	});
});

describe('saving, changing and deleting a report (V2)', () => {
	const write = (over: Partial<ReportDefinitionWrite> = {}): ReportDefinitionWrite => ({
		name: 'Margin by buyer',
		folder: 'Sales',
		spec: spec({ dataset: 'invoices', columns: ['buyer', 'margin'], totals: ['margin'] }),
		periodPreset: 'this_month',
		from: '2026-11-01',
		to: '2026-11-30',
		openTo: 'me',
		roleIds: [],
		...over,
	});

	it('saves a report named after its maker: display name, email, username, else their id', async () => {
		const { service, definitions } = build();
		const created = await service.create(write(), person('adm_a'), now);
		expect(definitions.insert).toHaveBeenCalledWith(created);
		expect(created).toMatchObject({
			name: 'Margin by buyer',
			createdBy: 'adm_a',
			createdByName: 'Rina Das',
			createdAt: at,
			updatedAt: at,
			version: 0,
		});
		expect(created.id).toMatch(/^rpt_/);
		const names: [unknown, string][] = [
			[person('adm_e'), 'raju@saha-textile.test'],
			[person('adm_u'), 'sudip'],
			[person('adm_blank'), 'adm_blank'],
			[person('adm_down'), 'adm_down'],
			[undefined, ''],
		];
		for (const [who, name] of names) expect((await service.create(write(), who as never)).createdByName).toBe(name);
		expect((await service.create(write(), undefined)).createdBy).toBeNull();
	});

	it('refuses a field the data doesn’t have, a total of a field that can’t be added up, and roles with none chosen', async () => {
		const { service } = build();
		await expect(
			service.create(
				write({ spec: spec({ dataset: 'invoices', columns: ['buyer'], totals: ['buyer'] }) }),
				person('adm_a'),
			),
		).rejects.toMatchObject(refusal('report_total_not_summable:buyer'));
		await expect(service.create(write({ openTo: 'roles' }), person('adm_a'))).rejects.toMatchObject(
			refusal('report_roles_needed'),
		);
	});

	it('lets only its maker change it over the version read, and delete it', async () => {
		const { service, definitions } = build({ definitions: [definition('rpt_mine')] });
		const changed = await service.update(
			'rpt_mine',
			{ ...write({ name: 'Margins' }), version: 0 },
			person('adm_a'),
			now,
		);
		expect(changed).toMatchObject({
			id: 'rpt_mine',
			name: 'Margins',
			createdBy: 'adm_a',
			updatedAt: at,
			version: 1,
		});
		const stale = service.update('rpt_mine', { ...write(), version: 0 }, person('adm_a'));
		await expect(stale).rejects.toBeInstanceOf(ConflictException);
		await expect(stale).rejects.toMatchObject(refusal('report_definition_changed'));
		await expect(
			service.update('rpt_mine', { ...write({ openTo: 'roles' }), version: 1 }, person('adm_a')),
		).rejects.toMatchObject(refusal('report_roles_needed'));
		for (const who of [person('adm_b'), undefined])
			await expect(service.remove('rpt_mine', who as never)).rejects.toBeInstanceOf(ForbiddenException);
		await expect(service.remove('rpt_gone', person('adm_a'))).rejects.toBeInstanceOf(NotFoundException);
		await service.remove('rpt_mine', person('adm_a'));
		expect(definitions.remove).toHaveBeenCalledWith('rpt_mine');
	});

	it('passes on any other failure to save a change', async () => {
		const diskFull = new Error('disk full');
		const failing = build({ definitions: [definition('rpt_mine')], saveFails: diskFull });
		await expect(failing.service.update('rpt_mine', { ...write(), version: 0 }, person('adm_a'))).rejects.toBe(
			diskFull,
		);
		const odd = { code: 'not an error' };
		const strange = build({ definitions: [definition('rpt_mine')], saveFails: odd });
		await expect(strange.service.update('rpt_mine', { ...write(), version: 0 }, person('adm_a'))).rejects.toBe(odd);
	});
});

describe('the report routes and module', () => {
	it('hand each call to the service, all needing accounts.index; run answers 200 and delete 204', async () => {
		const builder = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new ReportBuilderController(builder as never);
		const p = person('adm_a');
		const body = runOf(spec({ dataset: 'ledgerLines', columns: ['net'] }));
		const save = { name: 'x' } as never;
		const edit = { name: 'x', version: 0 } as never;
		expect([
			c.catalogue(),
			c.run(body as never, p),
			c.run(body as never),
			c.list(p),
			c.list(),
			c.get('rpt_1', p),
			c.get('rpt_1'),
			c.create(save, p),
			c.create(save),
			c.update('rpt_1', edit, p),
			c.update('rpt_1', edit),
		]).toEqual([
			['catalogue'],
			['run', body, p],
			['run', body, undefined],
			['list', p],
			['list', undefined],
			['get', 'rpt_1', p],
			['get', 'rpt_1', undefined],
			['create', save, p],
			['create', save, undefined],
			['update', 'rpt_1', edit, p],
			['update', 'rpt_1', edit, undefined],
		]);
		const removed = { remove: vi.fn(async () => undefined) };
		const d = new ReportBuilderController(removed as never);
		expect(await d.remove('rpt_1', p)).toBeUndefined();
		expect(await d.remove('rpt_1')).toBeUndefined();
		expect(removed.remove.mock.calls).toEqual([
			['rpt_1', p],
			['rpt_1', undefined],
		]);
		const methods = ['catalogue', 'run', 'list', 'get', 'create', 'update', 'remove'] as const;
		const perm = (m: (typeof methods)[number]) =>
			new Reflector().get(PERMISSIONS_KEY, ReportBuilderController.prototype[m]);
		expect(methods.map(perm)).toEqual(Array(7).fill(['accounts.index']));
		const code = (m: (typeof methods)[number]) =>
			Reflect.getMetadata('__httpCode__', ReportBuilderController.prototype[m]);
		expect([code('run'), code('remove')]).toEqual([200, 204]);
		expect(Reflect.getMetadata('imports', ReportsModule)).toEqual([
			LedgerModule,
			AccountsTemplatesModule,
			LocationsModule,
		]);
		expect(Reflect.getMetadata('controllers', ReportsModule)).toEqual([
			StatementsController,
			ReportBuilderController,
		]);
		expect(Reflect.getMetadata('providers', ReportsModule)).toEqual([
			StatementsService,
			ReportBuilderService,
			BooksReportsService,
		]);
		expect(AppModule.forRoot({} as never).imports).toContain(ReportsModule);
	});
});

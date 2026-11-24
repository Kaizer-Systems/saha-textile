import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ImportBringIn } from '@saha-textile/contracts';
import type { LedgerMatch } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BooksImportController, BooksImportService, applyChoices, readFile } from '../src/ledger/books-import';
import { LedgerModule } from '../src/ledger/ledger.module';

/** Bringing books in from Tally or a trial balance (accounts brief I1, W1–W3), and undoing it. */

const at = '2026-12-01T06:00:00.000Z';
const now = new Date(at);
const refusal = (code: string) => ({ response: { message: code } });
const owner = { userId: 'adm_owner', permissions: ['accounts.post', 'accounts.lock'] } as never;

/** A trial balance in our template: cash, capital, a bank, output tax, a customer, and a ledger with nothing in it. */
const CSV = [
	'Ledger,Group,Debit,Credit',
	'Cash,Cash-in-Hand,"5,000",',
	'Capital,Capital Account,,"20,000"',
	'HDFC Bank,Bank Accounts,"10,000",',
	'Output CGST,Duties & Taxes,,250',
	'Boutique Nila,Sundry Debtors,"5,250",',
	'Old Bank,Bank Accounts,,',
	'Mystery,Odd Group,,',
].join('\n');

const CHART = {
	groups: [
		{ id: 'g_cash', systemKey: 'cash_in_hand' },
		{ id: 'g_cap', systemKey: 'capital_account' },
		{ id: 'g_bank', systemKey: 'bank_accounts' },
		{ id: 'g_tax', systemKey: 'duties_and_taxes' },
		{ id: 'g_debt', systemKey: 'sundry_debtors' },
	],
	ledgers: [
		{ id: 'led_cash', name: 'Cash', systemKey: 'cash', roles: [] },
		{ id: 'led_ocgst', name: 'Output CGST (shop)', systemKey: null, roles: ['output_cgst'] },
		{ id: 'led_debtors', name: 'Sundry debtors', systemKey: null, roles: ['debtors_control'] },
	],
};

const bringIn = (over: Partial<ImportBringIn> = {}): ImportBringIn => ({
	source: 'template_csv',
	start: 'year_start',
	startOn: '2026-04-01',
	fileName: 'trial-balance.csv',
	text: CSV,
	locationId: 'loc_bar',
	choices: [],
	...over,
});

function build(options: { saved?: Record<string, unknown>[]; total?: number } = {}) {
	const saved = new Map((options.saved ?? []).map((e) => [e['id'] as string, e]));
	const store = {
		list: async () => [...saved.values()],
		get: async (id: string) => saved.get(id) ?? null,
		save: vi.fn(async (entry: Record<string, unknown>) => void saved.set(entry['id'] as string, entry)),
	};
	const books = { listVouchers: vi.fn(async () => ({ items: [], total: options.total ?? 7 })) };
	let made = 0;
	const ledger = {
		chart: async () => CHART,
		addLedger: vi.fn(async (_write: unknown, _by: string | null) => ({ id: `led_made_${++made}` })),
		post: vi.fn(async (_request: unknown, _context: unknown, _by: string | null) => ({ id: 'jv_open' })),
		reverse: vi.fn(async () => ({ id: 'jv_undo' })),
	};
	const audit = { append: vi.fn(async () => undefined) };
	const transactions = {
		withTransaction: vi.fn(async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' })),
	};
	const service = new BooksImportService(
		store as never,
		books as never,
		{ get: async (id: string) => (id === 'loc_bar' ? { id } : null) } as never,
		transactions as never,
		audit as never,
		ledger as never,
	);
	return { service, store, books, ledger, audit, transactions, saved };
}

describe('reading a file and laying choices over the matches', () => {
	it('reads a Tally masters export, and anything else as our trial balance template', () => {
		const xml =
			'<ENVELOPE><GROUP NAME="Cash Boxes"><PARENT>Cash-in-Hand</PARENT></GROUP>' +
			'<LEDGER NAME="Petty Cash"><PARENT>Cash Boxes</PARENT><OPENINGBALANCE>-1000.00</OPENINGBALANCE></LEDGER></ENVELOPE>';
		expect(readFile({ source: 'tally_xml', text: xml })).toEqual([
			{ name: 'Petty Cash', group: 'Cash Boxes', primary: 'Cash-in-Hand', openingPaise: 100_000 },
		]);
		expect(readFile({ source: 'template_csv', text: CSV })).toHaveLength(7);
	});

	it('keeps a match without a choice, takes a chosen ledger, or makes a new one in a chosen group', () => {
		const choose: LedgerMatch = { name: 'Mystery', how: 'choose', ledgerId: null, groupKey: null };
		const matches = [
			choose,
			{ ...choose, name: 'Empty' },
			{ ...choose, name: 'To a ledger' },
			{ ...choose, name: 'New' },
		];
		expect(
			applyChoices(matches, [
				{ name: 'Empty', ledgerId: null, groupKey: null },
				{ name: 'To a ledger', ledgerId: 'led_cash', groupKey: 'ignored' },
				{ name: 'New', ledgerId: null, groupKey: 'sundry_debtors' },
			]),
		).toEqual([
			choose,
			{ ...choose, name: 'Empty' },
			{ name: 'To a ledger', how: 'by_name', ledgerId: 'led_cash', groupKey: null },
			{ name: 'New', how: 'new', ledgerId: null, groupKey: 'sundry_debtors' },
		]);
	});
});

describe('checking a file (W2–W3)', () => {
	it('matches each ledger, counts what is placed and what to check, and balances the opening trial balance', async () => {
		const preview = await build().service.check(bringIn());
		expect(preview.rows.map((r) => [r.name, r.how, r.ledgerId, r.groupKey])).toEqual([
			['Cash', 'by_name', 'led_cash', null],
			['Capital', 'new', null, 'capital_account'],
			['HDFC Bank', 'new', null, 'bank_accounts'],
			['Output CGST', 'by_tax_head', 'led_ocgst', null],
			['Boutique Nila', 'party', 'led_debtors', null],
			['Old Bank', 'new', null, 'bank_accounts'],
			['Mystery', 'choose', null, null],
		]);
		expect(preview).toMatchObject({
			matched: 6,
			toCheck: 4,
			debitPaise: 2_025_000,
			creditPaise: 2_025_000,
			balanced: true,
			toChoose: 0,
		});
	});

	it('refuses a file it can read nothing from', async () => {
		await expect(build().service.check(bringIn({ text: 'Name,Amount\nCash,5' }))).rejects.toMatchObject(
			refusal('import_nothing_read'),
		);
	});
});

describe('bringing the books in (W3)', () => {
	it('makes the new ledgers with a balance, posts one opening journal the day before the books start, and logs it', async () => {
		const { service, ledger, store, audit, transactions } = build();
		const entry = await service.bringIn(bringIn(), owner, now);
		expect(ledger.addLedger.mock.calls).toEqual([
			[{ name: 'Capital', groupId: 'g_cap', active: true, expectedUpdatedAt: null }, 'adm_owner'],
			[{ name: 'HDFC Bank', groupId: 'g_bank', active: true, expectedUpdatedAt: null }, 'adm_owner'],
		]);
		expect(transactions.withTransaction).toHaveBeenCalledTimes(1);
		const [request, context, by] = ledger.post.mock.calls[0] as unknown as [
			Record<string, unknown>,
			unknown,
			unknown,
		];
		expect(request).toMatchObject({
			kind: 'journal',
			date: '2026-03-31',
			narration: 'Opening balances brought in from trial-balance.csv',
			source: { type: 'import', id: entry.id, number: null },
			idempotencyKey: `booksImport:${entry.id}`,
			lines: [
				{
					ledger: { id: 'led_cash' },
					locationId: 'loc_bar',
					narration: 'Opening balance',
					debitPaise: 500_000,
				},
				{
					ledger: { id: 'led_made_1' },
					locationId: 'loc_bar',
					narration: 'Opening balance',
					creditPaise: 2_000_000,
				},
				{
					ledger: { id: 'led_made_2' },
					locationId: 'loc_bar',
					narration: 'Opening balance',
					debitPaise: 1_000_000,
				},
				{
					ledger: { id: 'led_ocgst' },
					locationId: 'loc_bar',
					narration: 'Opening balance',
					creditPaise: 25_000,
				},
				{
					ledger: { id: 'led_debtors' },
					locationId: 'loc_bar',
					narration: 'Opening balance · Boutique Nila',
					debitPaise: 525_000,
				},
			],
		});
		expect([context, by]).toEqual([{ session: 'tx' }, 'adm_owner']);
		expect(entry).toMatchObject({
			source: 'template_csv',
			fileName: 'trial-balance.csv',
			startOn: '2026-04-01',
			locationId: 'loc_bar',
			voucherId: 'jv_open',
			ledgersMade: ['led_made_1', 'led_made_2'],
			debitPaise: 2_025_000,
			createdBy: 'adm_owner',
			createdAt: at,
			undoneAt: null,
			undoneBy: null,
			vouchersAtImport: 7,
		});
		expect(entry.id).toMatch(/^imp_/);
		expect(store.save).toHaveBeenCalledWith(entry);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: 'adm_owner',
				action: 'accounts.import',
				entityType: 'booksImport',
				entityId: entry.id,
				retentionTier: 'financial_security',
				metadata: { source: 'template_csv', ledgers: 7, made: 2 },
			}),
		);
	});

	it('brings in a ledger the person placed, names no file when there is none, and by nobody when no one is signed in', async () => {
		const { service, ledger } = build();
		const text = `${CSV}\nSundry,Odd Group,100,\nDrawings,Odd Group,,100`;
		const entry = await service.bringIn(
			bringIn({
				text,
				fileName: '',
				choices: [
					{ name: 'Sundry', ledgerId: 'led_cash', groupKey: null },
					{ name: 'Drawings', ledgerId: null, groupKey: 'capital_account' },
				],
			}),
			undefined,
		);
		expect(ledger.post.mock.calls[0]?.[0]).toMatchObject({ narration: 'Opening balances brought in' });
		expect(ledger.post.mock.calls[0]?.[2]).toBeNull();
		expect(ledger.addLedger.mock.calls.map(([write]) => (write as { name: string }).name)).toEqual([
			'Capital',
			'HDFC Bank',
			'Drawings',
		]);
		expect(entry.createdBy).toBeNull();
	});

	it('refuses ledgers still to place, an unbalanced file, one with nothing in it, and a location it doesn’t know', async () => {
		const unplaced = `${CSV}\nSundry,Odd Group,100,\nDrawings,Odd Group,,100`;
		await expect(build().service.bringIn(bringIn({ text: unplaced }), owner)).rejects.toMatchObject(
			refusal('import_ledgers_to_choose'),
		);
		const lopsided = 'Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,100,\nCapital,Capital Account,,90';
		await expect(build().service.bringIn(bringIn({ text: lopsided }), owner)).rejects.toMatchObject(
			refusal('import_not_balanced'),
		);
		const empty = 'Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,,';
		await expect(build().service.bringIn(bringIn({ text: empty }), owner)).rejects.toMatchObject(
			refusal('import_nothing_to_bring'),
		);
		await expect(build().service.bringIn(bringIn({ locationId: 'loc_gone' }), owner)).rejects.toMatchObject(
			refusal('location_unknown'),
		);
	});

	it('refuses a new ledger in a group the chart doesn’t have', async () => {
		const text = `${CSV}\nSundry,Odd Group,100,\nDrawings,Odd Group,,100`;
		const placed = bringIn({
			text,
			choices: [
				{ name: 'Sundry', ledgerId: 'led_cash', groupKey: null },
				{ name: 'Drawings', ledgerId: null, groupKey: 'investments' },
			],
		});
		await expect(build().service.bringIn(placed, owner)).rejects.toMatchObject(refusal('import_group_unknown'));
	});
});

describe('the imports and undoing one (W3)', () => {
	const entry = (over: Record<string, unknown> = {}) => ({
		id: 'imp_1',
		source: 'tally_xml',
		fileName: 'masters.xml',
		startOn: '2026-04-01',
		locationId: 'loc_bar',
		voucherId: 'jv_open',
		ledgersMade: ['led_made_1'],
		debitPaise: 2_025_000,
		createdBy: 'adm_owner',
		createdAt: at,
		undoneAt: null,
		undoneBy: null,
		vouchersAtImport: 7,
		...over,
	});

	it('lists the imports without the count of vouchers kept for undoing', async () => {
		const list = await build({ saved: [entry()] }).service.list();
		expect(list).toEqual([
			{
				id: 'imp_1',
				source: 'tally_xml',
				fileName: 'masters.xml',
				startOn: '2026-04-01',
				locationId: 'loc_bar',
				voucherId: 'jv_open',
				ledgersMade: ['led_made_1'],
				debitPaise: 2_025_000,
				createdBy: 'adm_owner',
				createdAt: at,
				undoneAt: null,
				undoneBy: null,
			},
		]);
	});

	it('reverses the opening journal while nothing new is posted, and logs it', async () => {
		const { service, ledger, store, audit } = build({ saved: [entry()], total: 8 });
		const undone = await service.undo('imp_1', owner, now);
		expect(ledger.reverse).toHaveBeenCalledWith(
			'jv_open',
			{ date: '2026-03-31', reason: 'Import undone', idempotencyKey: 'booksImportUndo:imp_1' },
			owner,
		);
		expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ undoneAt: at, undoneBy: 'adm_owner' }));
		expect(undone).toMatchObject({ undoneAt: at, undoneBy: 'adm_owner' });
		expect(undone).not.toHaveProperty('vouchersAtImport');
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'accounts.import.undo',
				entityId: 'imp_1',
				actorUserId: 'adm_owner',
				metadata: {},
			}),
		);
		const nobody = build({ saved: [entry()], total: 7 });
		expect((await nobody.service.undo('imp_1', undefined)).undoneBy).toBeNull();
	});

	it('refuses an import that isn’t there, one undone already, and one the books have moved on from', async () => {
		const missing = build().service.undo('imp_9', owner);
		await expect(missing).rejects.toBeInstanceOf(NotFoundException);
		await expect(missing).rejects.toMatchObject(refusal('import_not_found'));
		await expect(build({ saved: [entry({ undoneAt: at })] }).service.undo('imp_1', owner)).rejects.toMatchObject(
			refusal('import_undone'),
		);
		await expect(build({ saved: [entry()], total: 9 }).service.undo('imp_1', owner)).rejects.toMatchObject(
			refusal('import_books_in_use'),
		);
	});
});

describe('the import routes', () => {
	it('hand each call to the service: listing needs accounts.index, checking and bringing in accounts.post, undoing accounts.lock', () => {
		const imports = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new BooksImportController(imports as never);
		const body = bringIn();
		expect([
			c.list(),
			c.check(body),
			c.bringIn(body, owner),
			c.bringIn(body),
			c.undo('imp_1', owner),
			c.undo('imp_1'),
		]).toEqual([
			['list'],
			['check', body],
			['bringIn', body, owner],
			['bringIn', body, undefined],
			['undo', 'imp_1', owner],
			['undo', 'imp_1', undefined],
		]);
		const perm = (m: keyof BooksImportController) =>
			new Reflector().get(PERMISSIONS_KEY, BooksImportController.prototype[m]);
		expect([perm('list'), perm('check'), perm('bringIn'), perm('undo')]).toEqual([
			['accounts.index'],
			['accounts.post'],
			['accounts.post'],
			['accounts.lock'],
		]);
		expect(Reflect.getMetadata('controllers', LedgerModule)).toContain(BooksImportController);
		expect(Reflect.getMetadata('providers', LedgerModule)).toContain(BooksImportService);
	});
});

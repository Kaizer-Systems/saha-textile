import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { BankLine, MatchRule } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BanksController } from '../src/banks/banks.controller';
import { BanksModule } from '../src/banks/banks.module';
import { ReconcileService } from '../src/banks/reconcile.service';

/** Reconciling a bank account (accounts brief BA7, BA8, BA10). */

const at = '2026-11-28T06:00:00.000Z';
const period = { from: '2026-11-01', to: '2026-11-30' };
const poster = { userId: 'adm_1', permissions: ['accounts.edit'] } as never;

const line = (id: string, over: Partial<BankLine> = {}): BankLine => ({
	id,
	bankAccountId: 'bank_1',
	date: '2026-11-26',
	description: 'UPI/409912345678/SHREYA G',
	reference: '',
	outPaise: 0,
	inPaise: 150_000,
	balancePaise: null,
	key: `k_${id}`,
	importId: 'imp_1',
	status: 'unmatched',
	match: null,
	rejectedKeys: [],
	createdAt: at,
	...over,
});

interface Voucher {
	id: string;
	number: string;
	date: string;
	narration: string;
	source: { type: string; id: string; number: string | null } | null;
	lines: { ledgerId: string; debitPaise: number; creditPaise: number }[];
}
const voucher = (id: string, over: Partial<Voucher> = {}): Voucher => ({
	id,
	number: `RC/${id}`,
	date: '2026-11-26',
	narration: 'Payment received on order ST-1',
	source: null,
	lines: [
		{ ledgerId: 'led_bank', debitPaise: 150_000, creditPaise: 0 },
		{ ledgerId: 'led_adv', debitPaise: 0, creditPaise: 150_000 },
	],
	...over,
});

function build(
	lines: BankLine[],
	vouchers: Voucher[],
	options: {
		locationId?: string | null;
		locations?: unknown[];
		rules?: MatchRule[];
		openingVoucherId?: string | null;
		openingPaise?: number;
	} = {},
) {
	const store = new Map(lines.map((l) => [l.id, l]));
	const rules: MatchRule[] = [...(options.rules ?? [])];
	const posted: unknown[] = [];
	const audit = vi.fn(async () => undefined);
	const repo = {
		rules: async () => [...rules],
		saveRule: vi.fn(async (rule: MatchRule) => {
			const at = rules.findIndex((r) => r.id === rule.id);
			if (at >= 0) rules[at] = rule;
			else rules.push(rule);
		}),
		line: async (id: string) => store.get(id) ?? null,
		saveLine: vi.fn(async (next: BankLine) => void store.set(next.id, next)),
		inPeriod: async (accountId: string, from: string, to: string) =>
			[...store.values()]
				.filter((l) => l.bankAccountId === accountId && l.date >= from && l.date <= to)
				.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
		earliestLine: async (accountId: string) =>
			[...store.values()]
				.filter((l) => l.bankAccountId === accountId)
				.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
		importById: async (id: string) => (id === 'imp_1' ? { id, openingPaise: options.openingPaise ?? 0 } : null),
		heldVoucherIds: async (accountId: string, statuses: string[]) =>
			new Set(
				[...store.values()]
					.filter((l) => l.bankAccountId === accountId && statuses.includes(l.status))
					.flatMap((l) => l.match?.voucherIds ?? []),
			),
	};
	const books = {
		statementLines: async (ledgerId: string, from: string, to: string) =>
			vouchers
				.filter((v) => v.date >= from && v.date <= to)
				.flatMap((v) =>
					v.lines
						.filter((l) => l.ledgerId === ledgerId)
						.map((l) => ({
							voucherId: v.id,
							number: v.number,
							date: v.date,
							narration: v.narration,
							...l,
						})),
				),
		getVoucher: async (id: string) => vouchers.find((v) => v.id === id) ?? null,
		balanceBefore: async (ledgerId: string, day: string) =>
			vouchers
				.filter((v) => v.date < day)
				.flatMap((v) => v.lines.filter((l) => l.ledgerId === ledgerId))
				.reduce((sum, l) => sum + l.debitPaise - l.creditPaise, 0),
	};
	const service = new ReconcileService(
		repo as never,
		{
			get: async (id: string) =>
				id === 'bank_1'
					? {
							id: 'bank_1',
							ledgerId: 'led_bank',
							locationId: options.locationId === undefined ? null : options.locationId,
							openingVoucherId: options.openingVoucherId ?? null,
						}
					: null,
		} as never,
		books as never,
		{
			findById: async (id: string) => (id === 'pay_1' ? { reference: '409912345678' } : { reference: null }),
		} as never,
		{
			list: async () =>
				options.locations ?? [
					{ id: 'loc_bar', active: true, warehouse: true, shipsOnline: true, createdAt: '2026-01-01' },
				],
		} as never,
		{ withTransaction: async <T>(work: (context: unknown) => Promise<T>) => work({ session: 'tx' }) } as never,
		{ append: audit } as never,
		{
			post: vi.fn(async (request: unknown) => {
				posted.push(request);
				return { id: `jv_new${posted.length}` };
			}),
		} as never,
	);
	return { service, store, posted, audit, repo };
}

const BOOKS = [
	voucher('jv_upi', { source: { type: 'orderPayment', id: 'pay_1', number: 'RC/1' } }),
	voucher('jv_nila', {
		number: 'RC/26-27/000009',
		date: '2026-11-25',
		narration: 'Receipt RC/26-27/000009 · Boutique Nila',
		source: { type: 'businessReceipt', id: 'br_1', number: 'RC/26-27/000009' },
		lines: [
			{ ledgerId: 'led_bank', debitPaise: 3_700_000, creditPaise: 0 },
			{ ledgerId: 'led_debtors', debitPaise: 0, creditPaise: 3_700_000 },
		],
	}),
	voucher('jv_other', { date: '2026-11-27', source: { type: 'orderPayment', id: 'pay_9', number: null } }),
	// A contra on both sides of the account nets to nothing and is never offered.
	voucher('jv_both', {
		lines: [
			{ ledgerId: 'led_bank', debitPaise: 500, creditPaise: 0 },
			{ ledgerId: 'led_bank', debitPaise: 0, creditPaise: 500 },
		],
	}),
	voucher('jv_old', {
		date: '2026-09-01',
		narration: 'Payment to Nadia Weavers',
		lines: [{ ledgerId: 'led_bank', debitPaise: 0, creditPaise: 900 }],
	}),
	voucher('jv_rent', {
		date: '2026-11-20',
		narration: 'Rent for November',
		lines: [
			{ ledgerId: 'led_rent', debitPaise: 6_000_000, creditPaise: 0 },
			{ ledgerId: 'led_bank', debitPaise: 0, creditPaise: 6_000_000 },
		],
	}),
	voucher('jv_elsewhere', { lines: [{ ledgerId: 'led_cash', debitPaise: 100, creditPaise: 0 }] }),
];

const LINES = () => [
	line('l_upi'),
	line('l_nila', {
		date: '2026-11-28',
		description: 'NEFT CR BOUTIQUE NILA',
		reference: '0098 2210',
		inPaise: 3_700_000,
	}),
	line('l_sms', { date: '2026-11-28', description: 'SMS ALERT CHG', inPaise: 0, outPaise: 5_900 }),
	line('l_nadia', { date: '2026-11-27', description: 'NEFT DR NADIA WEAVERS', inPaise: 0, outPaise: 1_200_000 }),
	line('l_done', {
		date: '2026-11-10',
		status: 'accepted',
		match: {
			voucherIds: ['jv_old', 'jv_gone'],
			why: 'linked',
			sure: true,
			by: 'adm_1',
			at,
			entry: null,
			gstPercent: null,
			ruleId: null,
		},
	}),
	line('l_other_account', { bankAccountId: 'bank_2' }),
];

describe('the matching rules (BA10)', () => {
	it('lists the app’s rules then the ones added, changes a rule’s switch and words, and adds one at the end', async () => {
		const { service, audit } = build([], []);
		expect((await service.rules()).map((r) => [r.id, r.on])).toEqual([
			['rule_gateway_ref', true],
			['rule_upi_ref', true],
			['rule_amount_party', true],
			['rule_bank_charges', true],
			['rule_interest', true],
		]);
		const changed = await service.saveRule(
			{
				id: 'rule_bank_charges',
				when: 'upi_ref',
				words: ['SMS ALERT', 'CHG', 'ATM FEE'],
				onlyIn: true,
				then: 'match',
				gstPercent: 18,
				on: false,
			},
			poster,
			new Date(at),
		);
		expect(changed).toMatchObject({
			when: 'words',
			then: 'bank_charge',
			onlyIn: false,
			on: false,
			builtIn: true,
			updatedAt: at,
		});
		expect(changed.words).toContain('ATM FEE');
		const added = await service.saveRule(
			{ id: null, when: 'words', words: ['CASH DEP'], onlyIn: false, then: 'leave', gstPercent: null, on: true },
			undefined,
		);
		expect([added.order, added.builtIn, added.id.startsWith('mr_')]).toEqual([5, false, true]);
		const again = await service.saveRule({ ...added, words: ['CASH DEPOSIT'] }, poster);
		expect([again.id, again.order]).toEqual([added.id, 5]);
		expect((await service.rules()).map((r) => r.id).slice(-1)).toEqual([added.id]);
		await expect(
			service.saveRule(
				{
					id: 'mr_nope',
					when: 'words',
					words: ['X'],
					onlyIn: false,
					then: 'leave',
					gstPercent: null,
					on: true,
				},
				poster,
			),
		).rejects.toMatchObject({ response: { message: 'match_rule_unknown' } });
		await expect(
			service.saveRule(
				{ id: null, when: 'words', words: [], onlyIn: false, then: 'leave', gstPercent: null, on: true },
				poster,
			),
		).rejects.toMatchObject({ response: { message: 'match_rule_needs_words' } });
		expect(audit).toHaveBeenCalledTimes(3);
	});
});

describe('reconciling (BA7)', () => {
	it('suggests by reference, by amount and party, and by rule; leaves the rest; and shows matches with their entries', async () => {
		const { service } = build(LINES(), BOOKS);
		const suggested = await service.view('bank_1', { ...period, tab: 'suggested' });
		expect(suggested.counts).toEqual({ suggested: 3, unmatched: 1, accepted: 1 });
		expect(suggested.sure).toBe(2);
		expect(
			suggested.items.map((i) => [
				i.id,
				i.status,
				i.match?.why,
				i.match?.sure,
				i.entries.map((e) => e.voucherId),
			]),
		).toEqual([
			['l_upi', 'suggested', 'upi_ref', true, ['jv_upi']],
			['l_nila', 'suggested', 'amount_party', true, ['jv_nila']],
			['l_sms', 'suggested', 'rule:SMS ALERT', false, []],
		]);
		expect(suggested.items[2]?.match).toMatchObject({ entry: 'bank_charge', gstPercent: 18 });
		const unmatched = await service.view('bank_1', { ...period, tab: 'unmatched' });
		expect(unmatched.items.map((i) => i.id)).toEqual(['l_nadia']);
		const accepted = await service.view('bank_1', { from: '2026-11-01', to: '2026-11-15', tab: 'accepted' });
		expect(accepted.items[0]?.entries).toEqual([
			{
				voucherId: 'jv_old',
				number: 'RC/jv_old',
				date: '2026-09-01',
				narration: 'Payment to Nadia Weavers',
				inPaise: 0,
				outPaise: 900,
			},
		]);
		await expect(service.view('bank_9', { ...period, tab: 'suggested' })).rejects.toBeInstanceOf(NotFoundException);
	});

	it('accepts a suggestion, posts the entry a rule makes, and accepts every sure match at once', async () => {
		const { service, store, posted } = build(LINES(), BOOKS);
		const upi = await service.accept('bank_1', 'l_upi', period, poster);
		expect(upi).toMatchObject({
			status: 'accepted',
			match: { voucherIds: ['jv_upi'], by: 'adm_1', why: 'upi_ref' },
		});
		await service.accept('bank_1', 'l_sms', period, poster);
		expect(posted[0]).toMatchObject({
			kind: 'payment',
			date: '2026-11-28',
			source: { type: 'bankLine', id: 'l_sms' },
			idempotencyKey: 'bankLine:l_sms',
			lines: [
				{ ledger: { id: 'led_bank' }, creditPaise: 5_900, locationId: 'loc_bar' },
				{ ledger: { role: 'bank_charges' }, debitPaise: 5_000, locationId: 'loc_bar' },
				{ ledger: { role: 'input_cgst' }, debitPaise: 450 },
				{ ledger: { role: 'input_sgst' }, debitPaise: 450 },
			],
		});
		expect(store.get('l_sms')?.match?.voucherIds).toEqual(['jv_new1']);
		await expect(service.accept('bank_1', 'l_upi', period, poster)).rejects.toMatchObject({
			response: { message: 'bank_line_already_matched' },
		});
		await expect(service.accept('bank_1', 'l_nadia', period, poster)).rejects.toMatchObject({
			response: { message: 'bank_line_nothing_to_accept' },
		});
		await expect(service.accept('bank_1', 'nope', period, poster)).rejects.toBeInstanceOf(NotFoundException);
		await expect(service.accept('bank_1', 'l_other_account', period, poster)).rejects.toBeInstanceOf(
			NotFoundException,
		);
		const fresh = build(LINES(), BOOKS);
		expect(await fresh.service.acceptSure('bank_1', period, undefined)).toEqual({ accepted: 2 });
		expect([fresh.store.get('l_nila')?.status, fresh.store.get('l_sms')?.status]).toEqual([
			'accepted',
			'unmatched',
		]);
	});

	it('posts interest received on a deposit, at the account’s own location, and needs a location for a rule’s entry', async () => {
		const interest = line('l_int', { description: 'INT CR FD 0042', inPaise: 41_200 });
		const own = build([interest], [], { locationId: 'loc_gar' });
		await own.service.accept('bank_1', 'l_int', period, poster);
		expect(own.posted[0]).toMatchObject({
			kind: 'receipt',
			lines: [
				{ ledger: { id: 'led_bank' }, debitPaise: 41_200, locationId: 'loc_gar' },
				{ ledger: { role: 'interest_received' }, creditPaise: 41_200, locationId: 'loc_gar' },
			],
		});
		const nowhere = build([interest], [], { locations: [] });
		await expect(nowhere.service.accept('bank_1', 'l_int', period, poster)).rejects.toMatchObject({
			response: { message: 'books_need_a_location' },
		});
	});

	it('turns a suggestion down for good, entry or rule, and refuses when there is none', async () => {
		const { service, store } = build(LINES(), BOOKS);
		expect(await service.reject('bank_1', 'l_nila', period, poster)).toMatchObject({
			status: 'unmatched',
			rejectedKeys: ['jv_nila'],
		});
		await service.reject('bank_1', 'l_sms', period, undefined);
		expect(store.get('l_sms')?.rejectedKeys).toEqual(['rule_bank_charges']);
		const view = await service.view('bank_1', { ...period, tab: 'unmatched' });
		expect(view.items.map((i) => i.id)).toEqual(['l_nadia', 'l_nila', 'l_sms']);
		await expect(service.reject('bank_1', 'l_nadia', period, poster)).rejects.toMatchObject({
			response: { message: 'bank_line_nothing_to_reject' },
		});
	});
});

describe('linking by hand and breaking a match (BA8)', () => {
	it('links a line to entries that come to its amount, never one already held, and breaks a match again', async () => {
		const { service, store } = build(LINES(), BOOKS);
		const refusal = (code: string) => ({ response: { message: code } });
		await expect(service.link('bank_1', 'l_nadia', { voucherIds: ['jv_upi'] }, poster)).rejects.toMatchObject(
			refusal('bank_link_amount_differs:150000'),
		);
		await expect(service.link('bank_1', 'l_nadia', { voucherIds: ['jv_old'] }, poster)).rejects.toMatchObject(
			refusal('bank_link_entry_taken'),
		);
		await expect(service.link('bank_1', 'l_nadia', { voucherIds: ['jv_elsewhere'] }, poster)).rejects.toMatchObject(
			refusal('bank_link_entry_not_on_account'),
		);
		await expect(service.link('bank_1', 'l_nadia', { voucherIds: ['jv_missing'] }, poster)).rejects.toMatchObject(
			refusal('bank_link_entry_not_on_account'),
		);
		const rent = voucher('jv_rent2', {
			lines: [{ ledgerId: 'led_bank', debitPaise: 0, creditPaise: 1_200_000 }],
		});
		const withRent = build(LINES(), [...BOOKS, rent]);
		const linked = await withRent.service.link(
			'bank_1',
			'l_nadia',
			{ voucherIds: ['jv_rent2', 'jv_rent2'] },
			poster,
		);
		expect(linked.match).toMatchObject({ voucherIds: ['jv_rent2'], why: 'linked', sure: true, ruleId: null });
		await expect(
			withRent.service.link('bank_1', 'l_nadia', { voucherIds: ['jv_rent2'] }, poster),
		).rejects.toMatchObject(refusal('bank_line_already_matched'));
		expect(await service.unmatch('bank_1', 'l_done', undefined)).toMatchObject({
			status: 'unmatched',
			match: null,
		});
		expect(store.get('l_done')?.status).toBe('unmatched');
		await expect(service.unmatch('bank_1', 'l_nadia', poster)).rejects.toMatchObject(
			refusal('bank_line_not_matched'),
		);
		await expect(service.unmatch('bank_9', 'l_nadia', poster)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('finds the account’s entries not matched yet, by words or amount, newest first', async () => {
		const { service } = build(LINES(), BOOKS);
		const now = new Date('2026-11-29T06:00:00.000Z');
		expect((await service.findEntries('bank_1', '', now)).map((e) => e.voucherId)).toEqual([
			'jv_other',
			'jv_upi',
			'jv_nila',
			'jv_rent',
		]);
		expect((await service.findEntries('bank_1', 'nila', now)).map((e) => e.voucherId)).toEqual(['jv_nila']);
		expect((await service.findEntries('bank_1', '60000', now)).map((e) => e.voucherId)).toEqual(['jv_rent']);
	});
});

describe('the reconcile routes', () => {
	it('hand each call to the service, reading needs accounts.index and deciding accounts.edit', async () => {
		const rc = new Proxy(
			{},
			{
				get:
					(_t, name: string) =>
					(...args: unknown[]) => [name, ...args],
			},
		);
		const c = new BanksController({} as never, {} as never, rc as never);
		const p = poster;
		expect([
			c.matchRules(),
			c.saveMatchRule({ when: 'words' } as never, p),
			c.reconcileView('b', period as never),
			c.reconcileEntries('b', { q: 'nila' }),
			c.brs('b', { asAt: '2026-11-30' }),
			c.acceptSure('b', period, p),
			c.acceptLine('b', 'l', period, p),
			c.rejectLine('b', 'l', period, p),
			c.linkLine('b', 'l', { voucherIds: ['v'] }, p),
			c.unmatchLine('b', 'l', p),
		]).toEqual([
			['rules'],
			['saveRule', { when: 'words' }, p],
			['view', 'b', period],
			['findEntries', 'b', 'nila'],
			['brs', 'b', '2026-11-30'],
			['acceptSure', 'b', period, p],
			['accept', 'b', 'l', period, p],
			['reject', 'b', 'l', period, p],
			['link', 'b', 'l', { voucherIds: ['v'] }, p],
			['unmatch', 'b', 'l', p],
		]);
		const perm = (m: keyof BanksController) => new Reflector().get(PERMISSIONS_KEY, BanksController.prototype[m]);
		expect([perm('matchRules'), perm('reconcileView'), perm('reconcileEntries'), perm('brs')]).toEqual(
			Array(4).fill(['accounts.index']),
		);
		expect(
			(['saveMatchRule', 'acceptSure', 'acceptLine', 'rejectLine', 'linkLine', 'unmatchLine'] as const).map(perm),
		).toEqual(Array(6).fill(['accounts.edit']));
		expect(Reflect.getMetadata('providers', BanksModule)).toContain(ReconcileService);
	});
});

describe('the bank reconciliation statement (BA9)', () => {
	const entry = (id: string, date: string, paise: number, narration = id) =>
		voucher(id, {
			number: id.toUpperCase(),
			date,
			narration,
			lines: [{ ledgerId: 'led_bank', debitPaise: Math.max(0, paise), creditPaise: Math.max(0, -paise) }],
		});
	const BOOKS_BRS = [
		entry('jv_open', '2026-11-01', 1_000_000, 'Opening balance'),
		entry('jv_upi', '2026-11-26', 150_000),
		entry('jv_chq', '2026-11-20', -4_500_000, 'Cheque 000416 Haritala Estates'),
		entry('jv_dep', '2026-11-28', 200_000, 'Cash deposited'),
	];
	const BANK = () => [
		line('l_first', { date: '2026-11-01', description: 'NEFT CR X', inPaise: 300_000 }),
		line('l_upi', {
			status: 'accepted',
			match: {
				voucherIds: ['jv_upi'],
				why: 'upi_ref',
				sure: true,
				by: null,
				at,
				entry: null,
				gstPercent: null,
				ruleId: null,
			},
		}),
		line('l_nadia', { date: '2026-11-27', description: 'NEFT DR NADIA WEAVERS', inPaise: 0, outPaise: 1_200_000 }),
		line('l_sms', { date: '2026-11-28', description: 'SMS ALERT CHG', inPaise: 0, outPaise: 5_900 }),
	];

	it('goes from the books to the bank item by item, and agrees with the statements', async () => {
		const { service } = build(BANK(), BOOKS_BRS, { openingVoucherId: 'jv_open', openingPaise: 1_000_000 });
		const brs = await service.brs('bank_1', '2026-11-30');
		expect([brs.bookPaise, brs.startsOn, brs.computedPaise, brs.statementPaise]).toEqual([
			-3_150_000,
			'2026-11-01',
			244_100,
			244_100,
		]);
		expect(brs.rows.map((r) => [r.kind, r.paise, r.items.map((i) => i.text)])).toEqual([
			['unpresented', 4_500_000, ['JV_CHQ · Cheque 000416 Haritala Estates']],
			['uncredited', -200_000, ['JV_DEP · Cash deposited']],
			['bank_in', 300_000, ['NEFT CR X']],
			['bank_out', -1_200_000, ['NEFT DR NADIA WEAVERS']],
			['bank_charges', -5_900, ['SMS ALERT CHG']],
			['before_start', 0, []],
		]);
	});

	it('shows a difference already there when the statements start, and nothing before the first one', async () => {
		const later = BOOKS_BRS.map((v) => (v.id === 'jv_open' ? { ...v, date: '2026-10-01' } : v));
		const { service } = build(BANK(), later, { openingVoucherId: 'jv_open', openingPaise: 900_000 });
		const brs = await service.brs('bank_1', '2026-11-30');
		expect(brs.rows.at(-1)).toEqual({
			kind: 'before_start',
			paise: -100_000,
			items: [{ date: '2026-11-01', text: '', paise: -100_000 }],
		});
		expect(brs.computedPaise).toBe(brs.statementPaise);
		// Without the account knowing its opening voucher, one inside the statements' days shows as outstanding.
		const inside = BOOKS_BRS.map((v) => (v.id === 'jv_open' ? { ...v, date: '2026-11-05' } : v));
		const noOpening = build(BANK(), inside, { openingPaise: 1_000_000 });
		const withEntry = await noOpening.service.brs('bank_1', '2026-11-30');
		expect(withEntry.rows[1]?.items.map((i) => i.text)).toEqual([
			'JV_OPEN · Opening balance',
			'JV_DEP · Cash deposited',
		]);
		expect(await service.brs('bank_1', '2026-10-31')).toEqual({
			asAt: '2026-10-31',
			bookPaise: 1_000_000,
			rows: [],
			computedPaise: 1_000_000,
			statementPaise: null,
			startsOn: '2026-11-01',
		});
		expect((await build([], BOOKS_BRS).service.brs('bank_1', '2026-11-30')).startsOn).toBeNull();
	});
});

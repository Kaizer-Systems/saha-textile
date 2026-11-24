import { AccountsListQuery, type AccountsListRow } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AccountsListsController, AccountsListsService } from '../src/ledger/accounts-lists';

/** Accounts › Vouchers and the Day book (accounts brief A1–A9, A3): names, cost shown only where it may be. */

const row = (over: Partial<AccountsListRow>): AccountsListRow => ({
	id: 'x',
	tab: 'receipts',
	number: 'RC/26-27/000014',
	date: '2026-11-23',
	party: 'Meera Sharma',
	against: 'ST-2611-514203',
	detail: 'upi',
	reference: null,
	amountINR: 9560,
	moneyInINR: 9560,
	moneyOutINR: null,
	stock: null,
	soldBy: null,
	by: 'adm_1',
	approvedBy: null,
	status: 'issued',
	extra: {},
	...over,
});
const page = (items: AccountsListRow[]) => ({ items, total: items.length, counts: { all: items.length }, totals: {} });
const query = AccountsListQuery.parse({ from: '2026-11-01', to: '2026-11-30' });

function setup() {
	const reader = {
		list: vi.fn(async () =>
			page([
				row({ id: 'r1' }),
				row({
					id: 's1',
					tab: 'stockAdjustments',
					by: 'usr_2',
					approvedBy: 'usr_gone',
					amountINR: 620,
					extra: { itcReversedINR: 31, journalNumber: 'JV/26-27/000013' },
				}),
				row({ id: 'p1', tab: 'paymentVouchers', by: 'usr_3' }),
				row({ id: 'n1', by: null }),
			]),
		),
		dayBook: vi.fn(async () => page([row({ id: 'r2', by: 'usr_4' })])),
	};
	const users: Record<string, unknown> = {
		adm_1: { displayName: 'Owner' },
		usr_2: { displayName: '', email: 'manager@saha-textile.test' },
		usr_3: { username: 'staff3' },
		usr_4: {},
	};
	const admins = {
		findById: vi.fn(async (id: string) => {
			if (id === 'usr_gone') throw new Error('gone');
			return (users[id] as never) ?? null;
		}),
	};
	return { service: new AccountsListsService(reader as never, admins as never), reader };
}

const owner = { userId: 'adm_1', permissions: ['accounts.index', 'stock.cost'] } as never;
const clerk = { userId: 'usr_5', permissions: ['accounts.index'] } as never;

describe('accounts lists', () => {
	it('names who made and approved each row, and reads today in India time', async () => {
		const { service, reader } = setup();
		const shown = await service.list('receipts', query, owner, new Date('2026-11-23T20:00:00Z'));
		expect(reader.list).toHaveBeenCalledWith('receipts', query, '2026-11-24');
		expect(shown.items.map((item) => [item.id, item.by, item.approvedBy])).toEqual([
			['r1', 'Owner', null],
			['s1', 'manager@saha-textile.test', null],
			['p1', 'staff3', null],
			['n1', null, null],
		]);
		expect(shown.items[1]).toMatchObject({ amountINR: 620, extra: { itcReversedINR: 31 } });
		await service.list('receipts', query, owner);
	});

	it('keeps a stock adjustment’s value and input tax from those who can’t see cost', async () => {
		const { service } = setup();
		const shown = await service.list('stockAdjustments', query, clerk);
		expect(shown.items[1]).toMatchObject({
			amountINR: null,
			extra: { itcReversedINR: null, journalNumber: 'JV/26-27/000013' },
		});
		expect(shown.items[2]).toMatchObject({ amountINR: 9560 });
	});

	it('writes the Day book with names, someone unknown as nobody', async () => {
		const { service, reader } = setup();
		expect((await service.dayBook(query, owner)).items[0]?.by).toBeNull();
		expect(reader.dayBook).toHaveBeenCalledWith(query);
	});

	it('serves both, and the picked print, through the admin routes', async () => {
		const lists = { list: vi.fn(async () => 'list'), dayBook: vi.fn(async () => 'day') };
		const prints = { picked: vi.fn(async () => ({ fileName: 'creditNotes-2.pdf', data: new Uint8Array([7]) })) };
		const controller = new AccountsListsController(lists as never, prints as never);
		expect(await controller.list('creditNotes', query, owner)).toBe('list');
		expect(lists.list).toHaveBeenCalledWith('creditNotes', query, owner);
		expect(await controller.dayBook(query, owner)).toBe('day');
		const headers: Record<string, string> = {};
		const reply = {
			header: (name: string, value: string) => {
				headers[name] = value;
				return reply;
			},
			send: vi.fn(),
		};
		await controller.print('creditNotes', { ids: ['cn_1', 'cn_2'] }, reply as never);
		expect(prints.picked).toHaveBeenCalledWith('creditNotes', ['cn_1', 'cn_2']);
		expect(headers['Content-Disposition']).toBe('attachment; filename="creditNotes-2.pdf"');
		expect(reply.send).toHaveBeenCalledWith(Buffer.from([7]));
	});
});

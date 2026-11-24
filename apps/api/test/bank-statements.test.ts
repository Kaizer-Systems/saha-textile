import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSIONS_KEY } from '../src/auth/session.guard';
import { BanksController } from '../src/banks/banks.controller';
import { BanksModule } from '../src/banks/banks.module';
import { StatementsService } from '../src/banks/statements.service';

/** Bank statements (accounts brief BA4–BA6). */

const NOW = new Date('2026-11-28T06:00:00.000Z');
const LAYOUT = {
	id: 'lay_hdfc',
	name: 'HDFC',
	skipRows: 1,
	dateFormat: 'DD/MM/YY',
	money: 'split',
	columns: {
		date: 0,
		description: 1,
		reference: 2,
		withdrawal: 3,
		deposit: 4,
		amount: null,
		drcr: null,
		balance: null,
	},
	updatedAt: NOW.toISOString(),
};

function setup() {
	const layouts = [LAYOUT];
	const inserted: unknown[][] = [];
	const imports: Record<string, unknown>[] = [];
	const service = new StatementsService(
		{
			layouts: async () => layouts,
			saveLayout: async (l: typeof LAYOUT) => void layouts.push(l),
			keysIn: async (_id: string, keys: string[]) => new Set(keys.filter((k) => k.includes('CCAV'))),
			insertLines: async (lines: unknown[]) => void inserted.push(lines),
			insertImport: async (entry: Record<string, unknown>) => void imports.push(entry),
			lines: vi.fn(async () => ({ items: [], total: 0, counts: {} })),
		} as never,
		{ get: async (id: string) => (id === 'bank_1' ? { id } : null) } as never,
		{ withTransaction: (work: (context: object) => Promise<unknown>) => work({}) } as never,
	);
	return { service, inserted, imports, layouts };
}

const line = (patch: Record<string, unknown> = {}) => ({
	date: '2026-11-25',
	description: 'UPI IN',
	reference: 'U1',
	outPaise: 0,
	inPaise: 1_000,
	balancePaise: null,
	...patch,
});

describe('statement layouts (BA5)', () => {
	it('saves a layout that has a date, a description and its money columns, new or replacing', async () => {
		const s = setup();
		const { id: _id, updatedAt: _at, ...write } = LAYOUT;
		const fresh = await s.service.saveLayout({ ...write, id: null } as never, NOW);
		expect(fresh.id).toMatch(/^lay_/);
		expect((await s.service.saveLayout({ ...write, id: 'lay_hdfc' } as never, NOW)).id).toBe('lay_hdfc');
		await s.service.saveLayout({
			...write,
			id: null,
			money: 'signed_drcr',
			columns: { ...write.columns, amount: 3, drcr: 4 },
		} as never);
		const missing = (columns: Record<string, unknown>, money = 'split') =>
			expect(
				s.service.saveLayout({ ...write, id: null, money, columns: { ...write.columns, ...columns } } as never),
			).rejects.toThrow('bank_layout_incomplete');
		await missing({ date: null });
		await missing({ description: null });
		await missing({ deposit: null });
		await missing({ amount: null }, 'signed_drcr');
		expect((await s.service.layouts()).length).toBe(4);
	});
});

describe('reading and saving a statement (BA6)', () => {
	it('reads the rows by the layout and marks the lines already held', async () => {
		const s = setup();
		const preview = await s.service.preview('bank_1', {
			layoutId: 'lay_hdfc',
			rows: [
				['Date', 'Narration', 'Ref', 'W', 'D'],
				['25/11/26', 'NEFT CR CCAVENUE', 'CCAV98240', '', '98,240.00'],
				['26/11/26', 'UPI IN', 'U1', '', '15.00'],
				['bad', '', '', '', ''],
			],
		});
		expect(preview.lines.map((l) => [l.reference, l.already])).toEqual([
			['CCAV98240', true],
			['U1', false],
		]);
		expect(preview.problems).toEqual([{ row: 4, problem: 'date_unreadable' }]);
		await expect(s.service.preview('bank_none', { layoutId: 'lay_hdfc', rows: [] })).rejects.toThrow(
			'bank_account_not_found',
		);
		await expect(s.service.preview('bank_1', { layoutId: 'lay_none', rows: [] })).rejects.toThrow(
			'bank_layout_unknown',
		);
	});

	it('saves only when opening plus lines is the closing, each line once, recording the import', async () => {
		const s = setup();
		const write = {
			fileName: 'Acct_4821.csv',
			openingPaise: 5_000,
			closingPaise: 9_000,
			lines: [
				line(),
				line(),
				line({ reference: 'CCAV1', inPaise: 1_000 }),
				line({ reference: 'U2', date: '2026-11-27' }),
			],
		};
		const entry = await s.service.save('bank_1', write as never, { userId: 'adm_owner' } as never, NOW);
		expect(entry).toMatchObject({
			saved: 2,
			skipped: 2,
			lastDate: '2026-11-27',
			by: 'adm_owner',
			fileName: 'Acct_4821.csv',
		});
		expect(
			(s.inserted[0] as { reference: string; status: string; importId: string }[]).map((l) => [
				l.reference,
				l.status,
				l.importId === entry.id,
			]),
		).toEqual([
			['U1', 'unmatched', true],
			['U2', 'unmatched', true],
		]);
		await expect(
			s.service.save('bank_1', { ...write, closingPaise: 8_999 } as never, undefined, NOW),
		).rejects.toThrow('statement_totals_differ:9000');
		const none = setup();
		const all = await none.service.save(
			'bank_1',
			{ fileName: '', openingPaise: 0, closingPaise: 1_000, lines: [line({ reference: 'CCAV2' })] } as never,
			undefined,
			NOW,
		);
		expect([all.saved, all.skipped, all.by, none.inserted.length]).toEqual([0, 1, null, 0]);
		await expect(none.service.save('bank_none', write as never, undefined)).rejects.toThrow(
			'bank_account_not_found',
		);
		await none.service.lines('bank_1', {
			from: '2026-11-01',
			to: '2026-11-30',
			status: null,
			page: 1,
			pageSize: 50,
		});
	});
});

describe('statement routes', () => {
	it('read behind accounts.index, change behind accounts.edit, wired into the API', async () => {
		const st = Object.fromEntries(
			['layouts', 'saveLayout', 'preview', 'save', 'lines'].map((m) => [m, vi.fn(async () => m)]),
		);
		const c = new BanksController({} as never, st as never);
		const p = { userId: 'u' } as never;
		expect([
			await c.layouts(),
			await c.saveLayout({} as never),
			await c.preview('b', {} as never),
			await c.saveLines('b', {} as never, p),
			await c.lines('b', {} as never),
		]).toEqual(['layouts', 'saveLayout', 'preview', 'save', 'lines']);
		const perm = (m: keyof BanksController) => new Reflector().get(PERMISSIONS_KEY, BanksController.prototype[m]);
		expect([perm('layouts'), perm('lines')]).toEqual([['accounts.index'], ['accounts.index']]);
		expect([perm('saveLayout'), perm('preview'), perm('saveLines')]).toEqual(Array(3).fill(['accounts.edit']));
		expect(Reflect.getMetadata('providers', BanksModule)).toContain(StatementsService);
	});
});

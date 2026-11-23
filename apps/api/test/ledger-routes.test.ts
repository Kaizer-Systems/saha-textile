import { describe, expect, it } from 'vitest';

import { DocumentLocksController, LedgerController } from '../src/ledger/ledger.controller';

/** Every Accounts route hands its input to the ledger with who is acting (accounts brief Q, T, D10; T3 set-up). */

function recording() {
	const calls: unknown[][] = [];
	const service = new Proxy(
		{},
		{
			get:
				(_target, name) =>
				(...args: unknown[]) => (calls.push([name, ...args]), Promise.resolve(name)),
		},
	);
	return { calls, service: service as never };
}

describe('Accounts routes', () => {
	it('pass each request to the ledger', async () => {
		const { calls, service } = recording();
		const routes = new LedgerController(service);
		const principal = { userId: 'adm_owner' } as never;
		const body = { any: 'thing' } as never;
		await routes.chart();
		await routes.setUpBooks(principal);
		await routes.setUpBooks();
		await routes.addGroup(body, principal);
		await routes.addLedger(body, principal);
		await routes.saveLedger('led_1', body, principal);
		await routes.balances({ on: '2026-11-24' } as never, principal);
		await routes.statement('led_1', body, principal);
		await routes.vouchers(body);
		await routes.drafts();
		await routes.draft('vd_1');
		await routes.createDraft(body, principal);
		await routes.saveDraft('vd_1', body, principal);
		await routes.deleteDraft('vd_1', principal);
		await routes.voucher('jv_1');
		await routes.post(body, principal);
		await routes.reverse('jv_1', body, principal);
		await routes.periods();
		await routes.markFiled(body, principal);
		await routes.periodChecks({ month: '2026-11' } as never);
		await routes.lock(body, principal);
		expect(calls.map((c) => c[0])).toEqual([
			'chart',
			'setUpBooks',
			'setUpBooks',
			'addGroup',
			'addLedger',
			'saveLedger',
			'balances',
			'statement',
			'vouchers',
			'drafts',
			'draft',
			'saveDraft',
			'saveDraft',
			'deleteDraft',
			'voucher',
			'postByHand',
			'reverse',
			'periodGrid',
			'markFiled',
			'periodChecks',
			'lockPeriods',
		]);
		expect([calls[1]?.[1], calls[2]?.[1], calls[6]?.[1], calls[11]?.[1], calls[19]?.[1]]).toEqual([
			'adm_owner',
			null,
			'2026-11-24',
			null,
			'2026-11',
		]);
	});

	it('pass document locks to the ledger', async () => {
		const { calls, service } = recording();
		const locks = new DocumentLocksController(service);
		const target = { documentType: 'creditNote', documentId: 'cn_1' } as never;
		await locks.lock(target);
		await locks.touch(target);
		await locks.takeOver(target);
		await locks.release('creditNote', 'cn_1');
		expect(calls.map((c) => c.slice(0, 3))).toEqual([
			['lockDocument', 'creditNote', 'cn_1'],
			['touchDocument', 'creditNote', 'cn_1'],
			['takeOverDocument', 'creditNote', 'cn_1'],
			['releaseDocument', 'creditNote', 'cn_1'],
		]);
	});
});

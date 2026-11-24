import type { BankAccount } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BankAccountModel } from '../src/models/bank.model';
import { MongoBankRepository } from '../src/repositories/bank.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Bank accounts (accounts brief BA) in MongoDB:
 *   node scripts/secrets/test-login.mjs run saha_textile_bank_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/bank.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('bank accounts (integration, rs0)', () => {
	const repo = new MongoBankRepository();
	const tx = new MongoTransactionManager();
	const at = '2026-11-24T06:00:00.000Z';
	const account = (id: string, over: Partial<BankAccount> = {}): BankAccount =>
		({
			id,
			ledgerId: `led_${id}`,
			kind: 'current',
			ifsc: 'HDFC0001234',
			bankName: 'HDFC Bank',
			branch: 'Barasat',
			holder: 'K.R. Marketing',
			number: `5020001234${id.length}821`,
			shortName: `HDFC ${id}`,
			limitINR: null,
			ratePercent: null,
			maturesOn: null,
			locationId: null,
			openingINR: 0,
			openingOn: null,
			chequeFrom: '',
			chequeTo: '',
			upiIds: [],
			active: true,
			openingVoucherId: null,
			version: 0,
			createdAt: at,
			updatedAt: at,
			updatedBy: null,
			...over,
		}) as BankAccount;

	beforeAll(async () => {
		await connectMongo();
		await BankAccountModel.syncIndexes();
		await BankAccountModel.deleteMany({});
	});
	afterAll(async () => {
		await BankAccountModel.deleteMany({});
		await disconnectMongo();
	});

	it('keeps an IFSC and number once, saves only over the version read, and lists by short name', async () => {
		await repo.insert(account('b'));
		await repo.insert(account('a2', { number: '1111222233' }));
		await expect(
			repo.insert(account('c', { ledgerId: 'led_other', number: '9999000011' })),
		).resolves.toBeUndefined();
		await expect(repo.insert(account('dup', { ledgerId: 'led_dup', number: '1111222233' }))).rejects.toThrow(
			'bank_account_exists',
		);
		// Anything else that stops a save is passed on as it is.
		await expect(
			repo.insert(account('bad', { ledgerId: undefined as never, number: '7777000011' })),
		).rejects.toThrow('ledgerId');
		const saved = await tx.withTransaction(async (context) => {
			const first = (await repo.get('b', context)) as BankAccount;
			return repo.save({ ...first, shortName: 'HDFC main' }, 0, context);
		});
		expect(saved.version).toBe(1);
		await expect(repo.save({ ...saved, shortName: 'Stale' }, 0)).rejects.toThrow('bank_account_changed');
		expect((await repo.list()).map((a) => a.shortName)).toEqual(['HDFC a2', 'HDFC c', 'HDFC main']);
		expect(await repo.get('none')).toBeNull();
	});
});

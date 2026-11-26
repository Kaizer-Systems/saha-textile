import type { OrderPayment, Settlement } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { SettlementModel } from '../src/models/bank.model';
import { PaymentModel } from '../src/models/orders-build.model';
import { MongoOrderPaymentRepository } from '../src/repositories/orders-build.repository';
import { MongoSettlementRepository } from '../src/repositories/settlement.repository';
import { MongoTransactionManager } from '../src/transaction-manager';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Gateway payouts and courier COD remittances (accounts brief Q10) in MongoDB:
 *   node scripts/secrets/test-login.mjs run saha_textile_bank_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/settlements.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('settlements (integration, rs0)', () => {
	const repo = new MongoSettlementRepository();
	const payments = new MongoOrderPaymentRepository();
	const tx = new MongoTransactionManager();
	const at = '2026-11-28T06:00:00.000Z';
	const settlement = (id: string, over: Partial<Settlement> = {}): Settlement => ({
		id,
		kind: 'gateway',
		provider: 'CCAvenue',
		payoutReference: `UTR_${id}`,
		date: '2026-11-22',
		bankAccountId: 'bank_1',
		rows: [
			{
				reference: 'tr_1',
				grossPaise: 100,
				chargesPaise: 2,
				gstPaise: 0,
				orderId: 'ord_1',
				orderNumber: 'ST-1',
				paymentId: 'pay_1',
			},
		],
		grossPaise: 100,
		chargesPaise: 2,
		gstPaise: 0,
		netPaise: 98,
		matched: 1,
		voucherId: null,
		fileName: 'payouts.csv',
		createdAt: at,
		createdBy: null,
		...over,
	});
	const payment = (id: string, over: Partial<OrderPayment> = {}): OrderPayment =>
		({
			id,
			orderId: 'ord_1',
			method: 'gateway',
			state: 'received',
			amountINR: 1,
			currency: 'INR',
			amount: 1,
			reference: id,
			gateway: { id: 'ccavenue', attemptId: `att_${id}`, reference: `tr_${id}`, requestId: null },
			receivedOn: '2026-11-10',
			recordedBy: null,
			recordedAt: at,
			...over,
		}) as OrderPayment;

	beforeAll(async () => {
		await connectMongo();
		await SettlementModel.syncIndexes();
		await Promise.all([SettlementModel.deleteMany({}), PaymentModel.deleteMany({ _id: /^stl_/ })]);
	});
	afterAll(async () => {
		await Promise.all([SettlementModel.deleteMany({}), PaymentModel.deleteMany({ _id: /^stl_/ })]);
		await disconnectMongo();
	});

	it('keeps each payout once per provider, lists them by kind and period, and says which payments are paid', async () => {
		await tx.withTransaction(async (context) => {
			await repo.insert(settlement('s1'), context);
			await repo.insert(settlement('s2', { date: '2026-11-18', rows: [] }), context);
		});
		await repo.insert(settlement('s3', { kind: 'cod', provider: 'Shiprocket', rows: [] }));
		await expect(repo.insert(settlement('s4', { payoutReference: 'UTR_s1' }))).rejects.toMatchObject({
			code: 11000,
		});
		expect((await repo.get('s1'))?.netPaise).toBe(98);
		expect(await repo.get('nope')).toBeNull();
		const page = await repo.list({ kind: 'gateway', from: '2026-11-01', to: '2026-11-30', page: 1, pageSize: 1 });
		expect([page.items.map((s) => s.id), page.total, page.counts]).toEqual([['s1'], 2, { gateway: 2, cod: 1 }]);
		expect([...(await repo.payoutReferencesIn('gateway', 'CCAvenue', ['UTR_s1', 'UTR_x']))]).toEqual(['UTR_s1']);
		expect([...(await repo.payoutReferencesIn('cod', 'CCAvenue', ['UTR_s1']))]).toEqual([]);
		expect([...(await repo.settledPaymentIds(['pay_1', 'pay_2']))]).toEqual(['pay_1']);
	});

	it('lists gateway payments that came in between two days', async () => {
		await payments.save(payment('stl_a'));
		await payments.save(payment('stl_b', { receivedOn: '2026-11-20' }));
		await payments.save(payment('stl_c', { method: 'upi', gateway: null }));
		await payments.save(payment('stl_d', { state: 'failed' }));
		const found = await payments.listGatewayReceived('2026-11-01', '2026-11-15');
		expect(found.map((p) => p.id)).toEqual(['stl_a']);
	});
});

import { randomBytes, randomUUID } from 'node:crypto';

import { EDocSettings, EDocument } from '@saha-textile/contracts';
import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo } from '../src/connection';
import { EDocCallModel, EDocKeysModel, EDocSettingsModel, EDocumentModel } from '../src/models/edocs.model';
import { MongoEDocKeyStore, MongoEDocRepository } from '../src/repositories/edocs.repository';

/**
 * E-invoice / e-way bill persistence (accounts brief addendum 2) against a real replica set:
 *   node scripts/secrets/test-login.mjs run saha_textile_edocs_test -- pnpm --filter @saha-textile/adapters-db-mongo test
 */
function hasMongoEnv(): boolean {
	if (process.env.RUN_DB_IT !== '1') return false;
	try {
		return buildMongoConfig().dbName.endsWith('_test');
	} catch {
		return false;
	}
}

describe.skipIf(!hasMongoEnv())('e-document persistence (integration, rs0)', () => {
	const repo = new MongoEDocRepository();
	const GSTIN = '19DBYPS6736R1ZZ';
	const wipe = async () => {
		await Promise.all([
			EDocSettingsModel.deleteMany({}),
			EDocumentModel.deleteMany({}),
			EDocCallModel.deleteMany({}),
			EDocKeysModel.deleteMany({}),
		]);
	};
	beforeAll(async () => {
		await connectMongo();
		await EDocumentModel.syncIndexes();
		await wipe();
	});
	afterAll(async () => {
		await wipe();
		await disconnectMongo();
	});

	it('saves settings once, then only over the copy read', async () => {
		const first = EDocSettings.parse({ gstin: GSTIN, updatedAt: new Date().toISOString() });
		await repo.saveSettings(first, null);
		expect((await repo.getSettings(GSTIN))?.eWayBillPath).toBe('manual');
		await expect(repo.saveSettings({ ...first, eWayBillThresholdINR: 1 }, null)).rejects.toBeInstanceOf(
			StaleVersionError,
		);
		await repo.saveSettings(
			{ ...first, eInvoiceEnabledFrom: '2027-04-01', updatedAt: new Date().toISOString() },
			first.updatedAt,
		);
		expect((await repo.getSettings(GSTIN))?.eInvoiceEnabledFrom).toBe('2027-04-01');
	});

	it('keeps one active record of a kind per document and lists by date', async () => {
		const base = EDocument.parse({
			id: randomUUID(),
			kind: 'eWayBill',
			gstin: GSTIN,
			documentType: 'taxInvoice',
			documentId: 'inv_1',
			documentNumber: 'TI/26-27/000119',
			documentDate: '2026-11-22',
			path: 'manual',
			status: 'active',
			ewbNumber: '34101234551270',
			createdAt: new Date().toISOString(),
			createdBy: 'usr_1',
		});
		await repo.insert(base);
		await expect(repo.insert({ ...base, id: randomUUID() })).rejects.toMatchObject({ code: 11000 });
		await repo.replace({ ...base, status: 'cancelled' });
		await repo.insert({ ...base, id: randomUUID(), ewbNumber: '34101234551271' });
		expect((await repo.findActive('eWayBill', 'inv_1'))?.ewbNumber).toBe('34101234551271');
		const list = await repo.list({ kind: 'eWayBill', gstin: GSTIN, q: '5512', page: 1, pageSize: 10 });
		expect(list.total).toBe(2);
	});

	it('seals keys with the server key and reads them back; a wrong key reads as none', async () => {
		const key = randomBytes(32);
		const store = new MongoEDocKeyStore(key);
		await store.put(GSTIN, 'irpDirect', {
			password: 'pw',
			clientId: 'cid',
			clientSecret: 'sec',
			publicKeyPem: null,
		});
		expect(await store.get(GSTIN, 'irpDirect')).toEqual({
			password: 'pw',
			clientId: 'cid',
			clientSecret: 'sec',
			publicKeyPem: null,
		});
		const raw = await EDocKeysModel.findById(`${GSTIN}:irpDirect`).lean().exec();
		expect(JSON.stringify(raw)).not.toContain('sec');
		expect(await new MongoEDocKeyStore(randomBytes(32)).get(GSTIN, 'irpDirect')).toBeNull();
	});
});

import { randomBytes } from 'node:crypto';

import { EDocument } from '@saha-textile/contracts';
import { StaleVersionError } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { EDocCallModel, EDocKeysModel, EDocSettingsModel, EDocumentModel } from '../src/models/edocs.model';
import { BundlePriceMethodModel, ProductBundleModel } from '../src/models/index';
import { MongoEDocKeyStore, MongoEDocRepository, UnavailableEDocKeyStore } from '../src/repositories/edocs.repository';
import {
	MongoBundlePriceMethodRepository,
	MongoProductBundleRepository,
} from '../src/repositories/merchandising.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe('e-document key stores without the database', () => {
	it('refuses keys of the wrong length', () => {
		expect(() => new MongoEDocKeyStore(new Uint8Array(16))).toThrow('EDOC_KEYS_KEY must be 32 bytes');
		expect(() => new MongoEDocKeyStore(new Uint8Array(32), new Uint8Array(8))).toThrow(
			'EDOC_KEYS_KEY_PREVIOUS must be 32 bytes',
		);
	});

	it('stores nothing without the server key', async () => {
		const store = new UnavailableEDocKeyStore();
		expect(store.available).toBe(false);
		await expect(store.put()).rejects.toThrow('edoc_keys_key_missing');
		expect(await store.get()).toBeNull();
		await expect(store.remove()).resolves.toBeUndefined();
	});
});

describe.runIf(hasMongoEnv())('e-documents and bundles: the remaining reads and writes (rs0)', () => {
	const P = runPrefix('edm');
	const GSTIN = '19DBYPS6736R1ZZ';
	const repo = new MongoEDocRepository();
	const at = '2026-11-20T10:00:00.000Z';

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await Promise.all([
			EDocumentModel.deleteMany({ _id: ours }),
			EDocCallModel.deleteMany({ _id: ours }),
			EDocSettingsModel.deleteMany({ _id: ours }),
			EDocKeysModel.deleteMany({ _id: { $regex: `^${GSTIN}:${P}` } }),
			ProductBundleModel.deleteMany({ _id: ours }),
			BundlePriceMethodModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('has no settings for an unknown registration, and refuses a save over a copy that was never there', async () => {
		expect(await repo.getSettings(`${P}none`)).toBeNull();
		await expect(repo.saveSettings({ gstin: `${P}none` } as never, at)).rejects.toMatchObject({
			name: 'StaleVersionError',
			current: { updatedAt: '', updatedBy: null },
		});
		await expect(repo.saveSettings({ gstin: `${P}bad`, $bad: 1 } as never, null)).rejects.not.toBeInstanceOf(
			StaleVersionError,
		);
	});

	it('finds e-documents by id and lists them by status and dates, with or without a registration', async () => {
		const doc = (key: string, documentDate: string) =>
			EDocument.parse({
				id: `${P}${key}`,
				kind: 'eInvoice',
				gstin: GSTIN,
				documentType: 'taxInvoice',
				documentId: `${P}inv_${key}`,
				documentNumber: `${P}TI/${key}`,
				documentDate,
				path: 'manual',
				status: 'active',
				irn: `${P}irn_${key}`,
				createdAt: at,
				createdBy: 'usr_1',
			});
		await repo.insert(doc('a', '2001-01-10'));
		await repo.insert(doc('b', '2001-02-10'));
		expect((await repo.findById(`${P}a`))?.documentNumber).toBe(`${P}TI/a`);
		expect(await repo.findById(`${P}none`)).toBeNull();
		const list = (over: Record<string, unknown>) =>
			repo.list({ kind: 'eInvoice', page: 1, pageSize: 50, ...over } as never);
		expect(
			(await list({ status: 'active', from: '2001-01-01', to: '2001-01-31' })).rows.map((row) => row.id),
		).toEqual([`${P}a`]);
		expect((await list({ from: '2001-02-01', to: '2001-12-31' })).rows.map((row) => row.id)).toEqual([`${P}b`]);
		expect((await list({ to: '2001-12-31' })).total).toBeGreaterThanOrEqual(2);
	});

	it('logs calls and lists them for one registration or all', async () => {
		await repo.logCall({
			id: `${P}call`,
			at: '2099-01-01T00:00:00.000Z',
			gstin: GSTIN,
			path: 'manual',
			action: 'test',
			documentNumber: null,
			ok: true,
			code: null,
			message: null,
			durationMs: 5,
			by: 'usr_1',
		} as never);
		expect((await repo.listCalls(GSTIN, 1, 1)).rows[0]?.id).toBe(`${P}call`);
		expect((await repo.listCalls(null, 1, 1)).total).toBeGreaterThanOrEqual(1);
	});

	it('finds no keys for a path never stored, and removes stored ones', async () => {
		const store = new MongoEDocKeyStore(randomBytes(32));
		expect(await store.get(GSTIN, `${P}never`)).toBeNull();
		await store.put(GSTIN, `${P}path`, {
			password: 'p',
			clientId: 'c',
			clientSecret: 's',
			publicKeyPem: null,
		} as never);
		await store.remove(GSTIN, `${P}path`);
		expect(await store.get(GSTIN, `${P}path`)).toBeNull();
	});

	it('lists bundles by product, stores their stock, and reads older price method rows', async () => {
		const bundles = new MongoProductBundleRepository();
		expect(await bundles.listByProductIds([])).toEqual([]);
		await insertRaw(ProductBundleModel as never, {
			_id: `${P}bundle`,
			productId: `${P}set`,
			levels: [],
			extras: [],
			pricing: { methodId: 'bpm_fixed_price' },
		});
		expect((await bundles.listByProductIds([`${P}set`])).length).toBe(1);
		await bundles.saveStock(`${P}set`, {
			setsPossible: 2,
			state: 'low_stock',
			soldOutPieces: [],
			soldOutChoices: [],
		} as never);
		expect(
			(await ProductBundleModel.findById(`${P}bundle`).lean<{ stock?: { setsPossible: number } }>().exec())?.stock
				?.setsPossible,
		).toBe(2);
		const methods = new MongoBundlePriceMethodRepository();
		await insertRaw(BundlePriceMethodModel as never, {
			_id: `${P}old_method`,
			code: `${P}old`,
			name: { en: 'Old' },
			base: { kind: 'pieces' },
			combine: 'all',
		});
		expect(await methods.findById(`${P}old_method`)).toMatchObject({
			inputs: [],
			rules: [],
			version: 1,
			sortOrder: 0,
			active: true,
			seeded: false,
		});
		expect(await methods.findById(`${P}none`)).toBeNull();
		expect((await methods.findByCode(`${P}old`))?.id).toBe(`${P}old_method`);
		expect(await methods.findByCode(`${P}none`)).toBeNull();
		await methods.save({
			id: `${P}new_method`,
			code: `${P}new`,
			name: { en: 'New' },
			help: {},
			inputs: [],
			base: { kind: 'pieces' },
			rules: [],
			combine: 'all',
			active: true,
			seeded: false,
			version: 1,
			sortOrder: 9,
		} as never);
		expect((await methods.list()).map((row) => row.id)).toEqual(
			expect.arrayContaining([`${P}old_method`, `${P}new_method`]),
		);
		await methods.deleteById(`${P}new_method`);
		expect(await methods.findById(`${P}new_method`)).toBeNull();
	});
});

import type { LegalPage } from '@saha-textile/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { LegalPageModel, LegalPageRevisionModel } from '../src/models/index';
import { MongoLegalPageRepository } from '../src/repositories/legal-page.repository';
import { hasMongoEnv } from './mongo-test-env';

const page = (version: number, en: string): LegalPage => ({
	slug: 'shipping-policy',
	title: { en: 'Shipping Policy', bn: 'শিপিং নীতি' },
	content: { en, bn: '<p>বাংলা</p>' },
	metaTitle: {},
	metaDescription: {},
	metaImageAssetId: null,
	version,
	updatedAt: `2026-11-16T10:0${version}:00.000Z`,
	updatedBy: 'adm_1',
});

describe.runIf(hasMongoEnv())('legal pages persistence (rs0)', () => {
	const pages = new MongoLegalPageRepository();

	beforeAll(async () => {
		await connectMongo();
		await Promise.all([LegalPageModel.syncIndexes(), LegalPageRevisionModel.syncIndexes()]);
		await LegalPageModel.deleteOne({ _id: 'shipping-policy' }).exec();
		await LegalPageRevisionModel.deleteMany({ slug: 'shipping-policy' }).exec();
	});

	afterAll(async () => {
		await LegalPageModel.deleteOne({ _id: 'shipping-policy' }).exec();
		await LegalPageRevisionModel.deleteMany({ slug: 'shipping-policy' }).exec();
		await disconnectMongo();
	});

	it('writes once on release, never over a stored page, and keeps every earlier version on save', async () => {
		expect(await pages.createIfMissing(page(1, '<p>First</p>'))).toBe(true);
		expect(await pages.createIfMissing(page(1, '<p>Not this</p>'))).toBe(false);
		expect((await pages.find('shipping-policy'))?.content['en']).toBe('<p>First</p>');

		const first = (await pages.find('shipping-policy')) as LegalPage;
		await pages.save(page(2, '<p>Second</p>'), first);
		expect(await pages.find('shipping-policy')).toMatchObject({ version: 2, content: { en: '<p>Second</p>' } });
		const kept = await LegalPageRevisionModel.find({ slug: 'shipping-policy' }).lean().exec();
		expect(kept.map((row) => [row._id, row.version, row.content['en']])).toEqual([
			['shipping-policy:1', 1, '<p>First</p>'],
		]);
		expect((await pages.list()).map((row) => row.slug)).toContain('shipping-policy');
	});
});

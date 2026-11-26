import { seedLanguages } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMongoConfig } from '../src/config';
import { connectMongo, disconnectMongo, getMongoose } from '../src/connection';
import {
	AddonTemplateModel,
	BlogPostModel,
	BuilderPageModel,
	ContentBlockModel,
	LanguageModel,
	MediaAssetModel,
	PageLayoutRevisionModel,
	ProductModel,
	SearchTermModel,
	StoreLocationModel,
} from '../src/models/index';
import { MongoLanguageCoverageRepository } from '../src/repositories/language-coverage.repository';
import { MongoLanguageRepository } from '../src/repositories/language.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Settings › Languages against the replica set: the stored list, and the per-language text the
 * to-do counts, the "missing" filters, delete and erase read.
 *
 * The counts read whole collections, so this file works in a database of its own (the test
 * database's name plus `_languages`, dropped at the end): its sparse rows never meet another
 * suite's listing, and another suite's rows never change its counts. Each run also uses its own
 * made-up language code from the private-use range (`qaa`–`qtz`).
 *
 *   MONGODB_PORT=27018 MONGODB_DB_NAME=saha_textile_test RUN_DB_IT=1 pnpm --filter @saha-textile/adapters-db-mongo test
 */
describe.runIf(hasMongoEnv())('languages persistence (rs0)', () => {
	const languages = new MongoLanguageRepository();
	const coverage = new MongoLanguageCoverageRepository();
	const prefix = runPrefix('lang');
	const letters = 'abcdefghijklmnopqrst';
	const pick = () => letters[Math.floor(Math.random() * letters.length)];
	const code = `q${pick()}${pick()}`;
	const id = (name: string) => `${prefix}${name}`;
	const now = new Date('2026-11-15T10:00:00.000Z');

	const ownDatabase = `${buildMongoConfig().dbName}_languages`;
	/** Drops this file's database, and never any other: it checks the name it is connected to. */
	const dropOwn = async () => {
		const db = getMongoose().connection.db;
		if (db?.databaseName !== ownDatabase) throw new Error(`refusing to drop ${db?.databaseName ?? 'nothing'}`);
		await db.dropDatabase();
	};

	beforeAll(async () => {
		await disconnectMongo();
		// A fresh database: build only the indexes this file uses, not every model's (see connectMongo).
		await connectMongo({ dbName: ownDatabase, autoIndex: false });
		await dropOwn();
	});

	afterAll(async () => {
		await dropOwn();
		await disconnectMongo();
	});

	it('saves a language row in place and reads it back with its dates', async () => {
		const [english] = seedLanguages(['en'], now.toISOString());
		const row = { ...english!, code, admin: false, shop: 'draft' as const, everOn: false, addedBy: 'adm_1' };
		await languages.save(row);
		const saved = await languages.save({ ...row, shop: 'on', everOn: true, changedBy: 'adm_2' });
		expect(saved).toMatchObject({ code, shop: 'on', everOn: true, addedBy: 'adm_1', changedBy: 'adm_2' });
		expect(saved.addedAt).toBe(now.toISOString());
		expect(await LanguageModel.countDocuments({ _id: code }).exec()).toBe(1);
		expect((await languages.list()).some((entry) => entry.code === code)).toBe(true);
		expect(await languages.find(`${code}x`)).toBeNull();
	});

	it('seeds only an empty list', async () => {
		// This file's own row is already there, so the seed must write nothing.
		expect(await languages.seedIfEmpty(seedLanguages(['en', 'bn'], now.toISOString()))).toBe(false);
		await LanguageModel.deleteMany({}).exec();
		expect(await languages.seedIfEmpty(seedLanguages(['bn', 'en'], now.toISOString()))).toBe(true);
		expect((await languages.list()).map((row) => row.code).sort()).toEqual(['bn', 'en']);
		expect(await languages.seedIfEmpty(seedLanguages(['en', 'hi'], now.toISOString()))).toBe(false);
	});

	it('finds live items missing text, minds “follows English” and rich text, and skips drafts', async () => {
		const text = (value: string) => ({ en: `English ${value}`, [code]: `${code} ${value}` });
		const product = (name: string, overrides: Record<string, unknown> = {}) => ({
			_id: id(name),
			sku: id(name),
			slug: id(name).toLowerCase().replace(/_/g, '-'),
			status: 'live',
			title: text('title'),
			shortDescription: text('short'),
			description: text('long'),
			seo: { title: text('seo'), description: text('seo') },
			optionGroups: [{ label: text('size'), terms: [{ code: 's', label: text('small') }] }],
			estimatedDeliveryText: null,
			media: { gallery: [id('photo_used')] },
			...overrides,
		});
		await insertRaw(ProductModel, product('complete'));
		await insertRaw(ProductModel, product('no_title', { title: { en: 'English only' } }));
		await insertRaw(
			ProductModel,
			product('no_value', {
				optionGroups: [{ label: text('size'), terms: [{ code: 'm', label: { en: 'Medium' } }] }],
			}),
		);
		await insertRaw(ProductModel, product('draft_gap', { status: 'draft', title: { en: 'Draft only' } }));
		// The delivery line may stay empty while English is empty; once English has one, it is needed.
		await insertRaw(ProductModel, product('delivery_unset', { estimatedDeliveryText: { en: '' } }));
		await insertRaw(ProductModel, product('delivery_needed', { estimatedDeliveryText: { en: 'In 3 days' } }));
		// An older shape the form no longer writes: erased with the rest, never a to-do.
		await insertRaw(
			ProductModel,
			product('older_shape', {
				attributes: [{ code: 'size', label: { en: 'Size' }, terms: [{ code: 's', label: { en: 'S' } }] }],
			}),
		);

		await insertRaw(BlogPostModel, {
			_id: id('post_empty_html'),
			slug: id('post-empty-html'),
			status: 'live',
			title: text('post'),
			content: { en: '<p>Article</p>', [code]: '<p> </p>' },
		});
		await insertRaw(BlogPostModel, {
			_id: id('post_full'),
			slug: id('post-full'),
			status: 'live',
			title: text('post'),
			content: { en: '<p>Article</p>', [code]: '<p>লেখা</p>' },
		});

		const missingProducts = await coverage.missingIds('products', code);
		expect(missingProducts).toEqual(
			expect.arrayContaining([id('no_title'), id('no_value'), id('delivery_needed')]),
		);
		for (const name of ['complete', 'draft_gap', 'delivery_unset', 'older_shape']) {
			expect(missingProducts).not.toContain(id(name));
		}

		const missingPosts = await coverage.missingIds('blog_posts', code);
		expect(missingPosts).toContain(id('post_empty_html'));
		expect(missingPosts).not.toContain(id('post_full'));

		const counts = await coverage.missing(code);
		expect(counts.products).toBe(3);
		expect(counts.blog_posts).toBe(1);
		expect(Object.keys(counts)).toEqual(expect.arrayContaining(['photos', 'blog_tags', 'addon_templates']));
	});

	it('counts Page Builder page settings and live or scheduled layouts missing a language, never ended ones', async () => {
		const words = (value: string) => ({ en: value, [code]: `${code} ${value}` });
		const section = (title: Record<string, string>) => ({
			id: 'news',
			type: 'newsletter',
			schemaVersion: 1,
			hidden: false,
			screens: { phone: true, tablet: true, computer: true },
			languages: 'all',
			from: null,
			until: null,
			look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' },
			block: null,
			title,
			subtitle: {},
		});
		const revision = (name: string, title: Record<string, string>) =>
			insertRaw(PageLayoutRevisionModel, {
				_id: id(name),
				layoutId: id(`lay_${name}`),
				number: 1,
				sections: [section(title)],
				assetIds: [],
				createdAt: now,
				createdBy: null,
				wentLiveAt: now,
			});
		await revision('live_full', words('Join'));
		await revision('coming_short', { en: 'Join' });
		await revision('ended_short', { en: 'Join' });
		const before = await coverage.missing(code);
		const entry = (name: string, from: Date, until: Date | null) => ({
			revisionId: id(name),
			layoutId: id(`lay_${name}`),
			from,
			until,
			by: null,
		});
		await insertRaw(BuilderPageModel, {
			_id: 'home:page',
			pageType: 'home',
			target: 'page',
			settings: {
				title: words('t'),
				description: { en: 'd' },
				heading: words('h'),
				headingShown: false,
				shareImage: null,
			},
			schedule: [
				entry('ended_short', new Date('2020-01-01T00:00:00.000Z'), new Date('2020-02-01T00:00:00.000Z')),
				entry('live_full', new Date('2021-01-01T00:00:00.000Z'), null),
				entry('coming_short', new Date('2999-01-01T00:00:00.000Z'), null),
			],
			pending: [],
			updatedAt: now,
		});
		const after = await coverage.missing(code);
		// The page's description lacks the language, and so does the layout still to come; the ended one doesn't count.
		expect(after.page_builder - before.page_builder).toBe(2);
		expect(await coverage.missingIds('page_builder', code)).toEqual(
			expect.arrayContaining(['home:page', id('lay_coming_short')]),
		);
		expect(await coverage.missingIds('page_builder', code)).not.toContain(id('lay_ended_short'));
		// English is filled everywhere here.
		expect((await coverage.missing('en')).page_builder).toBe(0);
		await BuilderPageModel.deleteOne({ _id: 'home:page' }).exec();
	});

	it('counts only photos the shop shows, never unused or deleted ones', async () => {
		const photo = (name: string, alt: Record<string, string>, deletedAt: Date | null = null) => ({
			_id: id(name),
			kind: 'image',
			purpose: 'product',
			status: 'ready',
			text: { alt, title: {}, caption: {} },
			deletedAt,
		});
		await insertRaw(MediaAssetModel, photo('photo_used', { en: 'Saree' }));
		await insertRaw(MediaAssetModel, photo('photo_unused', { en: 'Spare' }));
		await insertRaw(MediaAssetModel, photo('photo_draft_only', { en: 'Draft' }));
		await insertRaw(ProductModel, {
			_id: id('draft_owner'),
			sku: id('draft_owner'),
			slug: id('draft-owner'),
			status: 'draft',
			title: { en: 'Draft' },
			media: { gallery: [id('photo_draft_only')] },
		});
		const missing = await coverage.missingIds('photos', code);
		expect(missing).toContain(id('photo_used'));
		expect(missing).not.toContain(id('photo_unused'));
		expect(missing).not.toContain(id('photo_draft_only'));
	});

	it('counts items holding text in a language, then erases it everywhere, arrays included', async () => {
		await insertRaw(StoreLocationModel, {
			_id: id('store'),
			active: false,
			name: { en: 'Store', [code]: 'Store x' },
			address: { en: 'Road' },
			landmark: {},
		});
		await insertRaw(SearchTermModel, {
			_id: id('word'),
			status: 'draft',
			name: { en: 'saree' },
			spellings: { en: ['sari'], [code]: ['xx'] },
		});
		await insertRaw(ContentBlockModel, {
			_id: id('banner'),
			key: id('banner'),
			status: 'draft',
			alt: { en: 'Banner', [code]: 'Banner x' },
			localeImages: { [code]: { desktop: id('photo_used') } },
		});
		// A legacy add-on template whose name is plain text, beside one with a translated field.
		await insertRaw(AddonTemplateModel, {
			_id: id('addon_plain'),
			code: id('addon_plain'),
			label: 'Blouse stitching',
			priceINR: 500,
			fields: [{ key: 'bust', label: { en: 'Bust', [code]: 'Bust x' } }],
		});

		const held = await coverage.itemsWithText(code);
		// Seven products and two posts hold some of it, then the store, the word, the banner and the add-on.
		expect(held).toBe(13);

		const changed = await coverage.erase(code);
		expect(changed).toBe(held);
		expect(await coverage.itemsWithText(code)).toBe(0);

		const product = await ProductModel.collection.findOne({ _id: id('complete') } as never);
		expect(product?.title).toEqual({ en: 'English title' });
		expect(product?.optionGroups[0].label).toEqual({ en: 'English size' });
		expect(product?.optionGroups[0].terms[0].label).toEqual({ en: 'English small' });
		const word = await SearchTermModel.collection.findOne({ _id: id('word') } as never);
		expect(word?.spellings).toEqual({ en: ['sari'] });
		const banner = await ContentBlockModel.collection.findOne({ _id: id('banner') } as never);
		expect(banner?.localeImages).toEqual({});
		const addon = await AddonTemplateModel.collection.findOne({ _id: id('addon_plain') } as never);
		expect(addon?.label).toBe('Blouse stitching');
		expect(addon?.fields[0].label).toEqual({ en: 'Bust' });
		// Erasing again changes nothing.
		expect(await coverage.erase(code)).toBe(0);
	});
});

import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	BuilderPageModel,
	MediaFolderModel,
	MediaShareLinkModel,
	PageLayoutModel,
	PageLayoutRevisionModel,
	SavedBlockModel,
	ShippingExceptionModel,
	ShippingProviderConfigModel,
	ShippingRuleSetModel,
	ShippingRuleSetVersionModel,
} from '../src/models/index';
import {
	MongoMediaFolderRepository,
	MongoShareLinkRepository,
	MongoStorageLedgerRepository,
} from '../src/repositories/media-library.repository';
import {
	MongoPageLayoutRepository,
	MongoSavedBlockRepository,
	sectionAssetIds,
} from '../src/repositories/page-layout.repository';
import { MongoShippingRuleRepository } from '../src/repositories/shipping.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

describe('page section pictures (no database)', () => {
	it('reads pictures without per-language images', () => {
		const section = {
			type: 'banner_arrangement',
			pieces: [{ name: 'main', pictures: [{ images: { desktop: 'med_a', tablet: null, phone: 'med_b' } }] }],
		};
		expect(sectionAssetIds([section, { type: 'product_row' }] as never)).toEqual(['med_a', 'med_b']);
	});
});

describe.runIf(hasMongoEnv())('media library, page layouts and shipping: the remaining reads and writes (rs0)', () => {
	const P = runPrefix('lls');
	const at = '2026-11-20T10:00:00.000Z';

	beforeAll(async () => {
		await connectMongo();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await Promise.all([
			MediaFolderModel.deleteMany({ _id: ours }),
			MediaShareLinkModel.deleteMany({ _id: ours }),
			BuilderPageModel.deleteMany({ _id: ours }),
			PageLayoutModel.deleteMany({ _id: ours }),
			PageLayoutRevisionModel.deleteMany({ _id: ours }),
			SavedBlockModel.deleteMany({ _id: ours }),
			ShippingRuleSetModel.deleteMany({ _id: ours }),
			ShippingRuleSetVersionModel.deleteMany({ _id: ours }),
			ShippingExceptionModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('reads older folders, finds many, lists trashed children, moves, trashes, recounts and deletes them', async () => {
		const folders = new MongoMediaFolderRepository();
		await insertRaw(MediaFolderModel as never, { _id: `${P}old`, name: 'Old', parentId: null });
		await insertRaw(MediaFolderModel as never, {
			_id: `${P}bin`,
			name: 'Bin',
			parentId: `${P}old`,
			ancestors: [`${P}old`],
			trashedAt: new Date(at),
		});
		expect(await folders.findById(`${P}old`)).toMatchObject({
			ancestors: [],
			files: 0,
			bytes: 0,
			createdAt: undefined,
			updatedAt: undefined,
		});
		expect(await folders.findById(`${P}none`)).toBeNull();
		expect((await folders.findManyByIds([`${P}old`, `${P}bin`])).length).toBe(2);
		expect((await folders.listChildren(`${P}old`, { trashed: true })).map((row) => row.id)).toEqual([`${P}bin`]);
		await folders.move(`${P}none`, null, []);
		await folders.move(`${P}old`, null, []);
		await folders.setTrashed([`${P}old`], at, new Map());
		expect((await folders.findById(`${P}old`))?.trashedFrom).toBeNull();
		await folders.recount([`${P}old`]);
		expect((await folders.findById(`${P}old`))?.files).toBe(0);
		await folders.hardDelete([`${P}old`, `${P}bin`]);
		expect(await folders.findById(`${P}old`)).toBeNull();
	});

	it('reads an older share link, and finds none by an unknown id or code', async () => {
		const links = new MongoShareLinkRepository();
		await insertRaw(MediaShareLinkModel as never, {
			_id: `${P}link`,
			assetId: 'med_x',
			codeHash: createHash('sha256').update(P).digest('hex'),
			codeEnd: 'abcd',
			who: 'anyone',
			expiresAt: null,
			createdBy: 'usr_1',
		});
		expect(await links.findById(`${P}link`)).toMatchObject({
			passwordHash: null,
			opens: 0,
			createdAt: new Date(0).toISOString(),
		});
		expect(await links.findById(`${P}none`)).toBeNull();
		expect(await links.findByCodeHash(`${P}none`)).toBeNull();
		expect(await new MongoStorageLedgerRepository().reservedBytes('2999-01-01T00:00:00.000Z')).toBe(0);
	});

	it('reads older builder pages, layouts and revisions, and renames a layout', async () => {
		const layouts = new MongoPageLayoutRepository();
		await insertRaw(BuilderPageModel as never, {
			_id: `${P}type:page`,
			pageType: `${P}type`,
			target: 'page',
			safeMode: { at: new Date(at) },
			pending: [{ not: 'valid' }],
			updatedAt: new Date(at),
		});
		expect(await layouts.page(`${P}type` as never, 'page')).toMatchObject({
			schedule: [],
			safeMode: { by: null },
			pending: [],
		});
		await layouts.setSchedule(
			`${P}type` as never,
			'page',
			[{ revisionId: `${P}rev`, layoutId: `${P}lay`, from: at, until: '2026-12-01T00:00:00.000Z', by: null }],
			at,
		);
		expect((await layouts.page(`${P}type` as never, 'page'))?.schedule[0]?.until).toBe('2026-12-01T00:00:00.000Z');
		await insertRaw(PageLayoutModel as never, {
			_id: `${P}lay`,
			pageType: `${P}type`,
			target: 'page',
			name: 'L',
			createdAt: new Date(at),
			updatedAt: new Date(at),
			reviewRequest: { at: new Date(at) },
		});
		expect((await layouts.layout(`${P}lay`))?.reviewRequest).toEqual({ by: null, at, note: '' });
		expect(await layouts.layout(`${P}none`)).toBeNull();
		await layouts.renameLayout(`${P}lay`, 'Renamed', null, null, at);
		expect((await layouts.layout(`${P}lay`))?.name).toBe('Renamed');
		await insertRaw(PageLayoutRevisionModel as never, {
			_id: `${P}rev`,
			layoutId: `${P}lay`,
			number: 1,
			createdAt: new Date(at),
		});
		expect((await layouts.revision(`${P}rev`))?.sections).toEqual([]);
		expect(await layouts.revision(`${P}none`)).toBeNull();
		await insertRaw(BuilderPageModel as never, {
			_id: `${P}bare:page`,
			pageType: `${P}bare`,
			target: 'page',
			updatedAt: new Date(at),
		});
		expect(await layouts.prune({ keepGoLive: 100_000, draftsAfter: '1990-01-01T00:00:00.000Z' })).toBe(0);
	});

	it('lists saved blocks, older ones without who changed them', async () => {
		await insertRaw(SavedBlockModel as never, {
			_id: `${P}block`,
			name: `${P}Block`,
			section: {},
			createdAt: new Date(at),
			updatedAt: new Date(at),
		});
		expect(
			(await new MongoSavedBlockRepository().list()).find((row) => row.id === `${P}block`)?.updatedBy,
		).toBeNull();
	});

	it('lists rule sets, reads older versions and exceptions, and has no active versions for none', async () => {
		const rules = new MongoShippingRuleRepository();
		await rules.createRuleSet({
			id: `${P}set`,
			name: 'Set',
			description: '',
			use: 'both',
			kind: 'own',
			premadeKey: null,
			copiedFromId: null,
			activeVersion: 1,
			draft: { steps: [], adjust: [] },
			hasDraftChanges: false,
			testCarts: [],
			revision: 0,
			updatedBy: null,
		} as never);
		await insertRaw(ShippingRuleSetModel as never, {
			_id: `${P}bare_set`,
			name: 'Bare',
			use: 'both',
			kind: 'own',
			draft: { steps: [], adjust: [] },
		});
		expect((await rules.listRuleSets()).find((row) => row.id === `${P}bare_set`)).toMatchObject({
			revision: 0,
			updatedAt: undefined,
		});
		await insertRaw(ShippingRuleSetVersionModel as never, {
			_id: `${P}set:1`,
			ruleSetId: `${P}set`,
			version: 1,
			body: { steps: [], adjust: [] },
			activatedAt: new Date(at),
		});
		expect((await rules.activeVersions([`${P}set`]))[0]).toMatchObject({ activatedBy: null, acceptedChanges: [] });
		expect(await rules.activeVersions([])).toEqual([]);
		expect(await rules.activeVersions([`${P}bare_set`])).toEqual([]);
		await rules.saveException({
			id: `${P}exc`,
			target: { kind: 'product', productId: 'p' },
			domestic: { kind: 'free' },
			international: { kind: 'free' },
		} as never);
		expect((await rules.listExceptions()).find((row) => row.id === `${P}exc`)).toMatchObject({
			note: '',
			updatedBy: null,
		});
	});

	it('reads no settings, and saves them only over the revision read', async () => {
		const rules = new MongoShippingRuleRepository();
		vi.spyOn(ShippingProviderConfigModel, 'findById').mockReturnValueOnce({
			lean: () => ({ exec: async () => null }),
		} as never);
		expect(await rules.getSettings()).toBeNull();
		const update = vi.spyOn(ShippingProviderConfigModel, 'updateOne');
		update.mockReturnValueOnce({ exec: async () => ({ upsertedCount: 1 }) } as never);
		expect(await rules.saveSettings({ revision: 1, updatedBy: null } as never, 0)).toBe(true);
		update
			.mockReturnValueOnce({ exec: async () => ({ upsertedCount: 0 }) } as never)
			.mockReturnValueOnce({ exec: async () => ({ matchedCount: 0 }) } as never);
		expect(await rules.saveSettings({ revision: 1, updatedAt: at, updatedBy: null } as never, 0)).toBe(false);
	});
});

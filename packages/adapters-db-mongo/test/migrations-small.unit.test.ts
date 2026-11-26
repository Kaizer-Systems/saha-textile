import { beforeEach, describe, expect, it, vi } from 'vitest';

import { seedDocumentFormatsStep } from '../src/migrations/document-formats';
import { seedLegalPages } from '../src/migrations/legal-pages';
import { giveMailboxAccessRights } from '../src/migrations/mailbox-rights';
import { seedProfilesAndNameVersions } from '../src/migrations/media-versions';
import { setOwnerOrderNumberFormat } from '../src/migrations/order-number-format';
import { seedPremadeShippingRuleSets } from '../src/migrations/shipping-premade';
import { seedTodaysHomePage } from '../src/migrations/todays-home-page';

/** The models and repositories these migrations use, as in-memory stand-ins: every branch, no database. */
const world = vi.hoisted(() => ({
	accessRows: [] as Array<{ _id: string; canSend?: boolean }>,
	bulk: [] as unknown[],
	modified: 0,
	activeExists: false,
	upserts: [] as number[],
	created: [] as boolean[],
	photos: [] as Array<Record<string, unknown>>,
	named: 1,
	insertedProfiles: 1,
	layoutExists: false,
	revision: { id: 'rev_1' } as { id: string } | null,
	banners: [] as unknown[],
}));
const exec = <T>(value: () => T) => ({ exec: async () => value() });

vi.mock('../src/models/index', () => ({
	MailboxAccessModel: {
		find: () => ({ lean: () => exec(() => world.accessRows) }),
		bulkWrite: async (ops: unknown[]) => void world.bulk.push(ops),
	},
	SiteSettingModel: { updateOne: () => exec(() => ({ modifiedCount: world.modified })) },
	DocumentFormatModel: {
		exists: async () => world.activeExists,
		updateOne: () => exec(() => ({ upsertedCount: world.upserts.shift() ?? 0 })),
	},
	MediaAssetModel: {
		find: () => ({
			lean: () => ({
				cursor: () =>
					(async function* () {
						for (const photo of world.photos) yield photo;
					})(),
			}),
		}),
		bulkWrite: async (ops: unknown[]) => ({ modifiedCount: Math.min(world.named, ops.length) }),
	},
	MediaProfileModel: {},
	PageLayoutModel: { exists: () => exec(() => world.layoutExists) },
}));
vi.mock('../src/repositories/media-profile.repository', () => ({
	MongoMediaProfileRepository: class {
		insertMissing = async () => world.insertedProfiles;
		list = async () => [{ key: 'product_3x4', version: 2 }];
	},
}));
vi.mock('../src/repositories/legal-page.repository', () => ({
	MongoLegalPageRepository: class {
		createIfMissing = async () => world.created.shift() ?? false;
	},
}));
vi.mock('../src/repositories/shipping.repository', () => ({
	MongoShippingRuleRepository: class {
		createPremadeIfMissing = async () => world.created.shift() ?? false;
	},
}));
vi.mock('../src/migrations/legal-pages-as-shipped', () => ({
	LEGAL_PAGES_AS_SHIPPED: { 'privacy-policy': { title: { en: 'Privacy Policy' }, content: { en: '<p>x</p>' } } },
}));
vi.mock('../src/repositories/content-block.repository', () => ({
	MongoContentBlockRepository: class {
		list = async () => world.banners;
	},
}));
vi.mock('../src/repositories/site-settings.repository', () => ({
	MongoSiteSettingsRepository: class {
		get = async () => null;
	},
}));
vi.mock('../src/repositories/page-layout.repository', () => ({
	MongoPageLayoutRepository: class {
		createLayout = async () => undefined;
		saveDraft = async () => world.revision;
		goLive = async () => undefined;
	},
}));

beforeEach(() => {
	world.accessRows = [];
	world.bulk = [];
	world.modified = 0;
	world.activeExists = false;
	world.upserts = [];
	world.created = [];
	world.photos = [];
	world.named = 1;
	world.insertedProfiles = 1;
	world.layoutExists = false;
	world.revision = { id: 'rev_1' };
	world.banners = [];
});

describe('small migrations (no database)', () => {
	it('gives rights to older mailbox access rows, one or several, and says when there are none', async () => {
		expect(await giveMailboxAccessRights()).toBe('gave rights to 0 mailbox access rows');
		expect(world.bulk).toEqual([]);
		world.accessRows = [{ _id: 'a1', canSend: true }];
		expect(await giveMailboxAccessRights()).toBe('gave rights to 1 mailbox access row');
		world.accessRows = [{ _id: 'a1' }, { _id: 'a2', canSend: false }];
		expect(await giveMailboxAccessRights()).toBe('gave rights to 2 mailbox access rows');
	});

	it('sets the owner’s order number format once', async () => {
		world.modified = 1;
		expect(await setOwnerOrderNumberFormat()).toBe('order number format set to ST-YYMM-NNNNNN');
		world.modified = 0;
		expect(await setOwnerOrderNumberFormat()).toBe('order number format already set');
	});

	it('writes each document format once, leaving a document’s own active format on', async () => {
		world.upserts = [1];
		expect(await seedDocumentFormatsStep()).toBe('wrote 1 document format');
		world.activeExists = true;
		expect(await seedDocumentFormatsStep()).toBe('wrote 0 document formats');
	});

	it('writes the legal pages it has text for, one or none', async () => {
		world.created = [true];
		expect(await seedLegalPages(new Date('2026-11-20T00:00:00Z'))).toBe('wrote 1 legal page');
		expect(await seedLegalPages()).toBe('wrote 0 legal pages');
	});

	it('writes each pre-made shipping rule set once', async () => {
		world.created = [true];
		expect(await seedPremadeShippingRuleSets(new Date('2026-11-20T00:00:00Z'))).toBe(
			'wrote 1 pre-made shipping rule set',
		);
		expect(await seedPremadeShippingRuleSets()).toMatch(/^wrote 0 pre-made shipping rule sets$/);
	});

	it('names older photos’ versions in batches, reading rows with parts missing', async () => {
		world.photos = Array.from({ length: 201 }, (_, index) => ({
			_id: `med_${index}`,
			derivatives:
				index === 0
					? undefined
					: [{ role: 'card', storageKey: `media/${index}/card.webp`, width: 400, height: 533 }],
			...(index === 1
				? {
						purpose: 'banner',
						warnings: [],
						width: 1000,
						height: 500,
						versions: [],
						createdAt: new Date('2026-01-01T00:00:00Z'),
						processing: { processedAt: new Date('2026-01-02T00:00:00Z') },
					}
				: {}),
		}));
		world.named = 1;
		expect(await seedProfilesAndNameVersions(() => new Date('2026-11-20T00:00:00Z'))).toBe(
			'added 1 image profile; named the versions of 2 photos',
		);
		world.photos = [];
		world.insertedProfiles = 2;
		expect(await seedProfilesAndNameVersions()).toBe('added 2 image profiles; named the versions of 0 photos');
	});

	it('makes Today’s home page once, counting pictures only in sections that have pieces', async () => {
		world.layoutExists = true;
		expect(await seedTodaysHomePage()).toBe('Today’s home page already there');
		world.layoutExists = false;
		expect(await seedTodaysHomePage(new Date('2026-11-20T00:00:00Z'))).toMatch(
			/^made Today’s home page: \d+ sections, 0 banner pictures$/,
		);
		world.revision = null;
		await expect(seedTodaysHomePage()).rejects.toThrow('the first revision could not be written');
	});
});

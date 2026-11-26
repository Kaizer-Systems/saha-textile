import { SECTION_COMMON_DEFAULTS } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import {
	AuthSessionModel,
	BuilderPageModel,
	FaqEntryModel,
	InventoryLedgerModel,
	PageLayoutRevisionModel,
	ProductModel,
	SearchOutboxModel,
} from '../src/models/index';
import { MongoAuthSessionRepository } from '../src/repositories/auth.repository';
import { MongoFaqRepository } from '../src/repositories/content.repository';
import { MongoInventoryRepository } from '../src/repositories/inventory.repository';
import { MongoLanguageCoverageRepository } from '../src/repositories/language-coverage.repository';
import { MongoSearchOutboxRepository } from '../src/repositories/search-outbox.repository';
import { hasMongoEnv, insertRaw, runPrefix } from './mongo-test-env';

/**
 * Language coverage on a language code no real row holds (`zz`), so counting and erasing touch this run's rows only;
 * and the last few older-row reads of the session, FAQ, stock ledger and search outbox repositories.
 */
describe.runIf(hasMongoEnv())('language coverage and older rows (rs0)', () => {
	const P = runPrefix('langx');
	const coverage = new MongoLanguageCoverageRepository();
	const at = '2026-11-20T10:00:00.000Z';

	beforeAll(async () => {
		await connectMongo();
	});

	afterAll(async () => {
		const ours = { $regex: `^${P}` };
		await Promise.all([
			ProductModel.deleteMany({ _id: ours }),
			BuilderPageModel.deleteMany({ _id: ours }),
			PageLayoutRevisionModel.deleteMany({ _id: ours }),
			AuthSessionModel.deleteMany({ _id: ours }),
			FaqEntryModel.deleteMany({ _id: ours }),
			InventoryLedgerModel.deleteMany({ _id: ours }),
			SearchOutboxModel.deleteMany({ _id: ours }),
		]);
		await disconnectMongo();
	});

	it('names a layout once when its schedule shows it twice, skipping pages of no known type', async () => {
		const picture = {
			images: { desktop: 'med_x', tablet: null, phone: null },
			localeImages: {},
			versions: {},
			containsText: false,
			heading: { en: 'Evenings' },
			subheading: {},
			ctaLabel: {},
			spot: 'middle_start',
			ink: 'brand',
			backing: 'none',
			link: null,
			alt: { en: 'a', zz: 'z' },
			decorative: false,
			from: null,
			until: null,
		};
		await insertRaw(PageLayoutRevisionModel as never, {
			_id: `${P}rev`,
			layoutId: `${P}lay`,
			number: 1,
			createdAt: new Date(at),
			sections: [
				{
					...SECTION_COMMON_DEFAULTS,
					id: 'hero',
					type: 'banner_arrangement',
					arrangement: 'hero_full',
					phoneSides: 'below_side_by_side',
					pieces: [
						{
							name: 'main',
							pictures: [picture],
							slider: { seconds: 6, controls: 'bottom_center', after: 'loop' },
						},
					],
				},
			],
		});
		await insertRaw(BuilderPageModel as never, {
			_id: `${P}home`,
			pageType: 'home',
			target: `${P}t`,
			schedule: [
				{
					revisionId: `${P}rev`,
					layoutId: `${P}lay`,
					from: new Date('2001-01-01T00:00:00Z'),
					until: new Date('2999-01-01T00:00:00Z'),
				},
				{ revisionId: `${P}gone`, layoutId: `${P}lay`, from: new Date('2998-01-01T00:00:00Z'), by: 'usr_1' },
			],
			updatedAt: new Date(at),
		});
		await insertRaw(BuilderPageModel as never, {
			_id: `${P}odd`,
			pageType: `${P}unknown`,
			target: 'page',
			updatedAt: new Date(at),
		});
		const ids = await coverage.missingIds('page_builder', 'zz');
		expect(ids.filter((id) => id === `${P}lay`)).toHaveLength(1);
	});

	it('counts and erases a language’s photo alt words, leaving others and odd rows alone', async () => {
		await insertRaw(ProductModel as never, {
			_id: `${P}prod`,
			type: 'simple',
			sku: `${P}S`,
			slug: `${P}s`,
			title: { en: 'Silk', zz: 'Zilk' },
			optionGroups: [{ code: 'c', terms: [{ code: 'red', label: { en: 'Red' } }] }],
			media: { altOverrides: { med_1: { en: 'one', zz: 'uno' }, med_2: null, med_3: 'plain' } },
		});
		await insertRaw(ProductModel as never, {
			_id: `${P}other`,
			type: 'simple',
			sku: `${P}O`,
			slug: `${P}o`,
			title: { en: 'Other' },
			media: { altOverrides: { med_4: { en: 'four' } } },
		});
		expect(await coverage.itemsWithText('zz')).toBeGreaterThanOrEqual(2);
		expect(await coverage.erase('zz')).toBeGreaterThanOrEqual(2);
		const after = await ProductModel.findById(`${P}prod`)
			.lean<{ title: Record<string, string>; media: { altOverrides: Record<string, unknown> } }>()
			.exec();
		expect(after?.title).toEqual({ en: 'Silk' });
		expect(after?.media.altOverrides).toEqual({ med_1: { en: 'one' }, med_2: null, med_3: 'plain' });
	});

	it('creates a session with its last activity and lock times', async () => {
		const sessions = new MongoAuthSessionRepository();
		const session = await sessions.create({
			id: `${P}sess`,
			userId: `${P}adm`,
			audience: 'admin',
			roleAtLogin: null,
			refreshTokenHash: `${P}hash`,
			refreshFamilyId: `${P}family`,
			rotationCounter: 0,
			previousRefreshTokenHash: null,
			replacedBySessionId: null,
			csrfSecretHash: 'c',
			device: { userAgentHash: null, ipHash: null, country: null, label: null },
			persistent: false,
			revokeReason: null,
			createdAt: at,
			lastSeenAt: at,
			expiresAt: '2999-01-01T00:00:00.000Z',
			absoluteExpiresAt: '2999-01-01T00:00:00.000Z',
			revokedAt: null,
			lastActiveAt: at,
			lockedAt: at,
		} as never);
		expect(session.id).toBe(`${P}sess`);
		const raw = await AuthSessionModel.findById(`${P}sess`).lean<{ lockedAt: Date; lastActiveAt: Date }>().exec();
		expect(raw?.lockedAt.toISOString()).toBe(at);
	});

	it('lists FAQs by ids, and reads older stock ledger and search outbox rows', async () => {
		await insertRaw(FaqEntryModel as never, {
			_id: `${P}faq`,
			question: { en: 'Q' },
			answer: { en: 'A' },
			status: 'draft',
			categoryIds: [],
			productIds: [],
		});
		expect(
			(await new MongoFaqRepository().list({ audience: 'admin', ids: [`${P}faq`] } as never)).items.map(
				(row) => row.id,
			),
		).toEqual([`${P}faq`]);
		await insertRaw(InventoryLedgerModel as never, {
			_id: `${P}led`,
			variantId: `${P}var`,
			productId: `${P}prod`,
			quantityDelta: 1,
			balanceAfter: 1,
			source: 'manual_adjustment',
			createdAt: new Date(at),
		});
		const ledger = await new MongoInventoryRepository().listLedger({
			variantId: `${P}var`,
			page: 1,
			pageSize: 10,
		} as never);
		expect(ledger.items[0]).toMatchObject({ heldDelta: 0, heldAfter: 0 });
		await insertRaw(SearchOutboxModel as never, {
			_id: `${P}prod`,
			changedAt: new Date('2000-01-01T00:00:00Z'),
			nextAttemptAt: new Date('2000-01-01T00:00:00Z'),
			doneAt: null,
		});
		const due = await new MongoSearchOutboxRepository().changedSince(new Date('1999-12-31T00:00:00Z'), 1000);
		expect(due.find((row) => row.productId === `${P}prod`)?.attempts).toBe(0);
	});
});

import type { PageSection } from '@saha-textile/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { BuilderPageModel, PageLayoutModel, PageLayoutRevisionModel, SavedBlockModel } from '../src/models/index';
import {
	MongoPageLayoutRepository,
	MongoSavedBlockRepository,
	sectionAssetIds,
} from '../src/repositories/page-layout.repository';
import { hasMongoEnv } from './mongo-test-env';

const common = {
	schemaVersion: 1,
	hidden: false,
	screens: { phone: true, tablet: true, computer: true },
	languages: 'all' as const,
	from: null,
	until: null,
	look: { spaceAbove: 'none', spaceBelow: 'm', width: 'page', align: 'start', background: 'none' } as const,
	block: null,
};
const picture = (desktop: string, phone: string | null = null) => ({
	images: { desktop, tablet: null, phone },
	localeImages: { bn: { desktop: `${desktop}_bn`, tablet: null, phone: null } },
	versions: {},
	containsText: false,
	heading: {},
	subheading: {},
	ctaLabel: {},
	spot: 'middle_start' as const,
	ink: 'brand_dark' as const,
	backing: 'none' as const,
	link: null,
	alt: { en: 'a', bn: 'b' },
	decorative: false,
	from: null,
	until: null,
});
const hero: PageSection = {
	...common,
	id: 'hero',
	type: 'banner_arrangement',
	arrangement: 'hero_full',
	phoneSides: 'below_side_by_side',
	pieces: [
		{
			name: 'main',
			pictures: [picture('med_pb_1', 'med_pb_1p'), picture('med_pb_2')],
			slider: { seconds: 6, controls: 'bottom_center', after: 'loop' },
		},
	],
};
const letter: PageSection = { ...common, id: 'news', type: 'newsletter', title: { en: 'Join' }, subtitle: {} };

describe('page layout pictures', () => {
	it('lists every photo a section shows, art per language included, once', () => {
		expect(sectionAssetIds([hero, letter, hero]).sort()).toEqual(
			['med_pb_1', 'med_pb_1_bn', 'med_pb_1p', 'med_pb_2', 'med_pb_2_bn'].sort(),
		);
	});
});

describe.runIf(hasMongoEnv())('Page Builder persistence (rs0)', () => {
	const layouts = new MongoPageLayoutRepository();
	const blocks = new MongoSavedBlockRepository();
	const at = (minute: number) => `2026-11-17T06:${String(minute).padStart(2, '0')}:00.000Z`;
	const LAYOUT = 'lay_pb_test';

	const clean = async () => {
		await PageLayoutModel.deleteMany({ _id: /^lay_pb_test/ }).exec();
		await PageLayoutRevisionModel.deleteMany({ layoutId: /^lay_pb_test/ }).exec();
		await BuilderPageModel.deleteMany({ _id: 'home:pb_test_target' }).exec();
		await SavedBlockModel.deleteMany({ _id: /^blk_pb_test/ }).exec();
	};

	beforeAll(async () => {
		await connectMongo();
		await clean();
	});
	beforeEach(clean);
	afterAll(async () => {
		await clean();
		await disconnectMongo();
	});

	const create = () =>
		layouts.createLayout({
			id: LAYOUT,
			pageType: 'home',
			target: 'pb_test_target',
			name: 'Winter weddings',
			template: null,
			draftRevisionId: null,
			lastLiveRevisionId: null,
			createdAt: at(0),
			updatedAt: at(0),
			updatedBy: 'adm_1',
		});

	it('writes revisions append-only, numbered, and refuses a save over a newer draft', async () => {
		await create();
		const first = await layouts.saveDraft({
			layoutId: LAYOUT,
			sections: [hero],
			expectedDraftId: null,
			by: 'adm_1',
			at: at(1),
		});
		expect(first).toMatchObject({ layoutId: LAYOUT, number: 1, createdBy: 'adm_1', wentLiveAt: null });
		const second = await layouts.saveDraft({
			layoutId: LAYOUT,
			sections: [hero, letter],
			expectedDraftId: first?.id ?? null,
			by: 'adm_2',
			at: at(2),
		});
		expect(second?.number).toBe(2);
		// Another tab still holds revision 1: its save is refused, nothing is written.
		const stale = await layouts.saveDraft({
			layoutId: LAYOUT,
			sections: [letter],
			expectedDraftId: first?.id ?? null,
			by: 'adm_1',
			at: at(3),
		});
		expect(stale).toBeNull();
		expect((await layouts.revisions(LAYOUT, 10)).map((revision) => revision.number)).toEqual([2, 1]);
		expect((await layouts.layout(LAYOUT))?.draftRevisionId).toBe(second?.id);
		// The first revision is unchanged by everything after it.
		expect((await layouts.revision(first?.id ?? ''))?.sections).toEqual([hero]);
		// Media sees the pictures of every revision.
		const doc = await PageLayoutRevisionModel.findById(first?.id).lean().exec();
		expect(doc?.assetIds.sort()).toEqual(sectionAssetIds([hero]).sort());
	});

	it('goes live in one step: the schedule, the revision and the layout together', async () => {
		await create();
		const draft = await layouts.saveDraft({
			layoutId: LAYOUT,
			sections: [hero],
			expectedDraftId: null,
			by: null,
			at: at(1),
		});
		const id = draft?.id ?? '';
		await layouts.goLive({
			pageType: 'home',
			target: 'pb_test_target',
			entry: { revisionId: id, layoutId: LAYOUT, from: at(5), until: null, by: 'adm_1' },
			at: at(4),
		});
		expect((await layouts.page('home', 'pb_test_target'))?.schedule).toEqual([
			{ revisionId: id, layoutId: LAYOUT, from: at(5), until: null, by: 'adm_1' },
		]);
		expect((await layouts.revision(id))?.wentLiveAt).toBe(at(4));
		expect((await layouts.layout(LAYOUT))?.lastLiveRevisionId).toBe(id);
		await layouts.setSchedule('home', 'pb_test_target', [], at(6));
		expect((await layouts.page('home', 'pb_test_target'))?.schedule).toEqual([]);
	});

	it('keeps the last Go Live revisions and recent drafts, and never what a schedule or layout points at (Q12)', async () => {
		await create();
		let previous: string | null = null;
		const ids: string[] = [];
		for (let minute = 1; minute <= 5; minute++) {
			const revision = await layouts.saveDraft({
				layoutId: LAYOUT,
				sections: [letter],
				expectedDraftId: previous,
				by: null,
				at: at(minute),
			});
			previous = revision?.id ?? null;
			ids.push(previous ?? '');
		}
		// Revisions 1–3 went live; revision 1 is still on the schedule.
		for (const [index, id] of ids.slice(0, 3).entries()) {
			await layouts.goLive({
				pageType: 'home',
				target: 'pb_test_target',
				entry: { revisionId: id, layoutId: LAYOUT, from: at(10 + index), until: null, by: null },
				at: at(10 + index),
			});
		}
		await layouts.setSchedule(
			'home',
			'pb_test_target',
			[{ revisionId: ids[0] ?? '', layoutId: LAYOUT, from: at(10), until: null, by: null }],
			at(20),
		);
		// Keep 1 Go Live revision, and drafts written after minute 5 (so revision 4 is old).
		await layouts.prune({ keepGoLive: 1, draftsAfter: at(5) });
		const left = (await layouts.revisions(LAYOUT, 10)).map((revision) => revision.number);
		// 5: the draft pointer · 3: the newest Go Live · 1: on the schedule. 2 (older Go Live) and 4 (old draft) go.
		expect(left).toEqual([5, 3, 1]);
	});

	it('saves, lists and removes saved blocks', async () => {
		await blocks.save({
			id: 'blk_pb_test_1',
			name: 'Durga Puja promo pair',
			section: hero,
			createdAt: at(1),
			updatedAt: at(1),
			updatedBy: 'adm_1',
		});
		await blocks.save({
			id: 'blk_pb_test_1',
			name: 'Durga Puja promos',
			section: hero,
			createdAt: at(9),
			updatedAt: at(2),
			updatedBy: 'adm_2',
		});
		const found = await blocks.find('blk_pb_test_1');
		expect(found).toMatchObject({
			name: 'Durga Puja promos',
			createdAt: at(1),
			updatedAt: at(2),
			updatedBy: 'adm_2',
		});
		expect((await SavedBlockModel.findById('blk_pb_test_1').lean().exec())?.assetIds.length).toBe(5);
		await blocks.remove('blk_pb_test_1');
		expect(await blocks.find('blk_pb_test_1')).toBeNull();
	});
});

import {
	ARRANGEMENT_PIECES,
	type MediaAsset,
	PageSection,
	type PageTypeKey,
	type ScheduleEntry,
} from '@saha-textile/contracts';
import { ARRANGEMENT_PIECE_NAMES, SECTION_COMMON_DEFAULTS } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { layoutMaxAge } from '../src/page-builder/page-builder.controller';
import { PageBlocksService } from '../src/page-builder/page-blocks.service';
import { PageBuilderService, pictureFacts } from '../src/page-builder/page-builder.service';
import { memoryLayouts } from './page-builder-memory';

const section = (fields: Record<string, unknown>) => PageSection.parse(fields);
const letter = section({ id: 'news', type: 'newsletter', title: { en: 'Join', bn: 'যোগ দিন' } });
const banner = (assetId: string, versionId: string) =>
	section({
		id: 'hero',
		type: 'banner_arrangement',
		pieces: [
			{
				name: 'main',
				pictures: [
					{ images: { desktop: assetId }, versions: { [assetId]: versionId }, alt: { en: 'a', bn: 'b' } },
				],
			},
		],
	});

const asset = (state: 'ready' | 'making'): MediaAsset =>
	({
		id: 'med_1',
		deletedAt: null,
		visibility: 'public',
		text: { alt: {}, caption: {} },
		slug: 'hero-photo',
		width: 3380,
		height: 1000,
		processing: { state: 'ready', attempts: 1, error: null, processedAt: null },
		versions: [
			{
				id: 'ver_1',
				profileKey: 'banner_keep_shape',
				profileVersion: 1,
				fill: 'as_is',
				state,
				createdAt: '2026-11-17T00:00:00.000Z',
			},
		],
		derivatives: [
			{
				role: 'banner',
				storageKey: 'k1',
				width: 1690,
				height: 500,
				byteSize: 1,
				format: 'webp',
				roleVersion: 1,
				versionId: 'ver_1',
			},
			{
				role: 'banner',
				storageKey: 'k2',
				width: 845,
				height: 250,
				byteSize: 1,
				format: 'webp',
				roleVersion: 1,
				versionId: 'ver_1',
			},
		],
	}) as unknown as MediaAsset;

const harness = (media: MediaAsset | null = null) => {
	const switches: { value: { home: boolean } | null } = { value: { home: true } };
	const store = memoryLayouts();
	const audit = { append: vi.fn(async () => undefined) };
	const service = new PageBuilderService(
		store.repo,
		LanguageStore.fixed(['en', 'bn']),
		{ findById: async (id: string) => (id === 'adm_1' ? { displayName: 'Moulik' } : null) } as never,
		{ findById: async () => media, findManyByIds: async () => (media ? [media] : []) } as never,
		{ getUrl: (key: string) => `https://cdn/${key}` } as never,
		{
			get: async (key: string) =>
				key === 'storefront.pageBuilder' ? switches.value : { heroLayout: 'hero_full' },
		} as never,
		{ list: async () => [] } as never,
		audit as never,
	);
	return { service, store, audit, switches };
};

describe('Page Builder API (brief PG-1, PG-2, B)', () => {
	it('keeps core’s written-out section defaults equal to the contract’s (core reads contracts as types only)', () => {
		const parsed = PageSection.parse({ id: 'x', type: 'newsletter' });
		for (const [key, value] of Object.entries(SECTION_COMMON_DEFAULTS)) {
			expect(parsed[key as keyof typeof parsed]).toEqual(value);
		}
		expect(ARRANGEMENT_PIECE_NAMES).toEqual(ARRANGEMENT_PIECES);
	});

	it('lists Home with what shows now and the next switch (P1)', async () => {
		const { service, store } = harness();
		const created = await service.createLayout('adm_1', 'home', {
			name: 'Today’s home page',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		const draft = await service.saveDraft('adm_1', created.layout.id, {
			sections: [letter],
			expectedDraftId: null,
		});
		const entry: ScheduleEntry = {
			revisionId: draft.draft?.id ?? '',
			layoutId: created.layout.id,
			from: '2026-11-01T00:00:00.000Z',
			until: null,
			by: null,
		};
		await store.repo.goLive({ pageType: 'home' as PageTypeKey, target: 'page', entry, at: entry.from });
		await store.repo.goLive({
			pageType: 'home',
			target: 'page',
			entry: { ...entry, from: '2026-12-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' },
			at: entry.from,
		});
		const [home] = await service.pages(new Date('2026-11-17T00:00:00Z'));
		expect(home).toEqual({
			pageType: 'home',
			kind: 'whole_page',
			target: 'page',
			liveLayoutName: 'Today’s home page',
			nextSwitchAt: '2026-12-01T00:00:00.000Z',
			layoutCount: 1,
		});
		const page = await service.page('home', new Date('2026-11-17T00:00:00Z'));
		expect(page.layouts[0]).toMatchObject({
			status: 'live',
			updatedByName: 'Moulik',
			outline: [{ type: 'newsletter', arrangement: null }],
		});
		await expect(service.page('cart')).rejects.toMatchObject({ status: 404 });
	});

	it('makes a new layout as a copy of another’s draft, or blank (A2)', async () => {
		const { service, audit } = harness();
		const source = await service.createLayout('adm_1', 'home', {
			name: 'Source',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		await service.saveDraft('adm_1', source.layout.id, { sections: [letter], expectedDraftId: null });
		const copy = await service.createLayout('adm_1', 'home', {
			name: 'Winter weddings',
			start: 'copy',
			copyOf: source.layout.id,
			template: null,
			bringPictures: true,
		});
		expect(copy.draft?.sections).toEqual([letter]);
		expect(copy.layout).toMatchObject({
			name: 'Winter weddings',
			pageType: 'home',
			target: 'page',
			template: null,
		});
		const blank = await service.createLayout(null, 'home', {
			name: 'Empty',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		expect(blank.draft).toBeNull();
		expect(blank.problems).toEqual([{ kind: 'empty' }]);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'page_layout.create', entityType: 'page_layout' }),
		);
	});

	it('refuses a draft saved over a newer one, saying who saved it and when (FX-11)', async () => {
		const { service } = harness();
		const layout = await service.createLayout('adm_1', 'home', {
			name: 'Two tabs',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		const first = await service.saveDraft('adm_1', layout.layout.id, { sections: [letter], expectedDraftId: null });
		await service
			.saveDraft('adm_1', layout.layout.id, {
				sections: [letter, letter],
				expectedDraftId: first.draft?.id ?? null,
			})
			.catch(() => null);
		await expect(
			service.saveDraft(null, layout.layout.id, { sections: [], expectedDraftId: first.draft?.id ?? null }),
		).rejects.toMatchObject({ status: 409, response: { code: 'layout_moved_on', savedBy: 'Moulik' } });
	});

	it('lists what holds Go Live, with the pictures’ real state and shape', async () => {
		const making = harness(asset('making'));
		const one = await making.service.createLayout(null, 'home', {
			name: 'Hero',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		const view = await making.service.saveDraft(null, one.layout.id, {
			sections: [banner('med_1', 'ver_1')],
			expectedDraftId: null,
		});
		expect(view.problems).toEqual([
			{ kind: 'picture_not_ready', sectionId: 'hero', piece: 'main', picture: 0, assetId: 'med_1' },
		]);

		const ready = harness(asset('ready'));
		const two = await ready.service.createLayout(null, 'home', {
			name: 'Hero',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		expect(
			(
				await ready.service.saveDraft(null, two.layout.id, {
					sections: [banner('med_1', 'ver_1')],
					expectedDraftId: null,
				})
			).problems,
		).toEqual([]);
	});

	it('reads a version’s shape from its widest file, and a missing version as gone', () => {
		expect(pictureFacts(asset('ready'), 'ver_1')).toEqual({ ready: true, ratio: 3.38 });
		expect(pictureFacts(asset('ready'), 'ver_gone')).toBeNull();
		expect(pictureFacts(null, null)).toBeNull();
	});

	it('renames a layout and records who did it', async () => {
		const { service, audit } = harness();
		const layout = await service.createLayout('adm_1', 'home', {
			name: 'Old',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		expect((await service.rename('adm_1', layout.layout.id, { name: 'New' })).layout.name).toBe('New');
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'page_layout.rename', metadata: { from: 'Old', to: 'New' } }),
		);
		await expect(service.rename(null, 'lay_none', { name: 'x' })).rejects.toMatchObject({ status: 404 });
	});

	it('gives the shop the live layout in its language, and nothing when nothing is live', async () => {
		const { service, store, switches } = harness(asset('ready'));
		expect(await service.shopLayout('home', 'bn', new Date('2026-11-17T00:00:00Z'))).toEqual({
			pageType: 'home',
			revisionId: null,
			sections: [],
			refreshAt: null,
			settings: null,
		});
		const created = await service.createLayout(null, 'home', {
			name: 'Hero',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		const saved = await service.saveDraft(null, created.layout.id, {
			sections: [banner('med_1', 'ver_1'), letter],
			expectedDraftId: null,
		});
		await store.repo.goLive({
			pageType: 'home',
			target: 'page',
			entry: {
				revisionId: saved.draft?.id ?? '',
				layoutId: created.layout.id,
				from: '2026-11-01T00:00:00.000Z',
				until: '2026-12-01T00:00:00.000Z',
				by: null,
			},
			at: '2026-11-01T00:00:00.000Z',
		});
		const shop = await service.shopLayout('home', 'bn', new Date('2026-11-17T00:00:00Z'));
		// The switch off: the shop keeps its fixed page whatever is scheduled.
		switches.value = null;
		expect((await service.shopLayout('home', 'bn', new Date('2026-11-17T00:00:00Z'))).revisionId).toBeNull();
		switches.value = { home: true };
		expect(shop.revisionId).toBe(saved.draft?.id);
		expect(shop.refreshAt).toBe('2026-12-01T00:00:00.000Z');
		expect(shop.sections.map((section) => [section.id, section.title])).toEqual([
			['hero', null],
			['news', 'যোগ দিন'],
		]);
		const picture = shop.sections[0]?.pieces[0]?.pictures[0];
		expect(picture).toMatchObject({ key: 'hero:main:0', slot: 'main_0', alt: 'b' });
		expect(picture?.images.desktop.roles['banner']?.[0]?.url).toContain('https://cdn/');
		await expect(service.shopLayout('cart', 'en')).rejects.toMatchObject({ status: 404 });
	});

	it('keeps a layout answer until its next change, and never more than a minute', () => {
		const now = Date.parse('2026-11-17T00:00:00Z');
		expect(layoutMaxAge(null, now)).toBe(60);
		expect(layoutMaxAge('2026-11-17T00:00:20Z', now)).toBe(20);
		expect(layoutMaxAge('2026-11-17T05:00:00Z', now)).toBe(60);
		expect(layoutMaxAge('2026-11-16T23:59:00Z', now)).toBe(0);
	});

	it('lists Home’s templates and makes a layout from one, marked as a template so its sections stay (Q8, Q9)', async () => {
		const { service } = harness();
		const page = await service.page('home', new Date('2026-11-17T00:00:00Z'));
		expect(page.templates.map((template) => template.key)).toEqual([
			'today',
			'full_width_slides',
			'main_side_tile',
			'main_two_stacked',
			'centre_side_tiles',
		]);
		expect(page.templates[3]?.outline[0]).toEqual({ type: 'banner_arrangement', arrangement: 'hero_main_stack' });
		const made = await service.createLayout(null, 'home', {
			name: 'Paris',
			start: 'template',
			copyOf: null,
			template: 'main_two_stacked',
			bringPictures: false,
		});
		expect(made.layout.template).toBe('main_two_stacked');
		expect(made.draft?.sections.map((section) => section.id).slice(0, 3)).toEqual([
			'hero',
			'promos',
			'new_arrivals',
		]);
		await expect(
			service.createLayout(null, 'home', {
				name: 'x',
				start: 'template',
				copyOf: null,
				template: 'rome_page',
				bringPictures: true,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it('saves Page settings only with every shop language filled, lists what is missing, and the shop reads them (P3)', async () => {
		const { service, store, audit, switches } = harness();
		const page = await service.page('home');
		expect(page.settingsGaps).toEqual({
			en: ['title', 'description', 'heading'],
			bn: ['title', 'description', 'heading'],
		});
		const settings = {
			title: { en: 'Sarees from Kolkata', bn: 'কলকাতার শাড়ি' },
			description: { en: 'Woven by hand.', bn: '' },
			heading: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
			headingShown: false,
			shareImage: null,
		};
		await expect(service.saveSettings('adm_1', 'home', settings)).rejects.toMatchObject({
			response: { issues: [{ path: ['description', 'bn'], code: 'page_settings_incomplete' }] },
		});
		expect(store.pages.get('home:page')).toBeUndefined();
		const saved = await service.saveSettings('adm_1', 'home', {
			...settings,
			description: { en: '  Woven  by hand. ', bn: 'হাতে বোনা।' },
		});
		expect(saved.settings.description).toEqual({ en: 'Woven by hand.', bn: 'হাতে বোনা।' });
		expect(saved.settingsGaps).toEqual({});
		expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'page_builder.settings.save' }));
		// The shop reads them in its language, whichever page is drawn: the fixed one too.
		switches.value = { home: false };
		const shop = await service.shopLayout('home', 'bn');
		expect(shop.revisionId).toBeNull();
		expect(shop.settings).toEqual({
			title: 'কলকাতার শাড়ি',
			description: 'হাতে বোনা।',
			heading: 'সাহা টেক্সটাইল',
			headingShown: false,
			shareImageUrl: null,
		});
	});

	it('shares the version of the photo the settings chose', async () => {
		const { service } = harness({
			...asset('ready'),
			derivatives: [
				{
					role: 'share',
					storageKey: 's1',
					width: 1200,
					height: 628,
					byteSize: 1,
					format: 'jpeg',
					roleVersion: 1,
					versionId: 'ver_1',
				},
			],
		} as unknown as MediaAsset);
		const words = { en: 'x', bn: 'y' };
		const saved = await service.saveSettings(null, 'home', {
			title: words,
			description: words,
			heading: words,
			headingShown: true,
			shareImage: { assetId: 'med_1', versionId: 'ver_1' },
		});
		expect(saved.shareImageUrl).toBe('https://cdn/s1');
		expect((await service.shopLayout('home', 'en')).settings).toMatchObject({
			headingShown: true,
			shareImageUrl: 'https://cdn/s1',
		});
	});

	it('lists every switch still ahead, on every page, soonest first (SG-17)', async () => {
		const { service, store } = harness();
		const now = new Date('2026-11-20T00:00:00.000Z');
		const made = await service.createLayout(null, 'home', {
			name: 'Winter weddings',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: false,
		});
		await store.repo.setSchedule(
			'home',
			'page',
			[
				{
					revisionId: 'r1',
					layoutId: made.layout.id,
					from: '2026-12-01T00:00:00.000Z',
					until: '2027-02-15T00:00:00.000Z',
					by: null,
				},
				{
					revisionId: 'r0',
					layoutId: made.layout.id,
					from: '2026-10-01T00:00:00.000Z',
					until: '2026-10-10T00:00:00.000Z',
					by: null,
				},
			],
			now.toISOString(),
		);
		const { rows } = await service.comingUp(now);
		expect(rows).toEqual([
			{
				pageType: 'home',
				target: 'page',
				layoutId: made.layout.id,
				layoutName: 'Winter weddings',
				from: '2026-12-01T00:00:00.000Z',
				until: '2027-02-15T00:00:00.000Z',
				state: 'coming',
			},
		]);
	});

	it('gives the editing lock to one admin; the other may look but not save over them, until two quiet minutes (E4)', async () => {
		const { service } = harness();
		const made = await service.createLayout('adm_1', 'home', {
			name: 'Winter weddings',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: false,
		});
		const id = made.layout.id;
		expect(made.allowedSections).toContain('banner_arrangement');
		const t0 = new Date('2026-11-17T10:00:00.000Z');
		expect(await service.lock('adm_1', id, t0)).toMatchObject({
			granted: true,
			lock: { holderId: 'adm_1', holderName: 'Moulik', mine: true },
		});
		const later = new Date('2026-11-17T10:01:00.000Z');
		expect(await service.lock('adm_2', id, later)).toMatchObject({
			granted: false,
			lock: { holderId: 'adm_1', mine: false },
		});
		await expect(
			service.saveDraft('adm_2', id, { sections: [letter], expectedDraftId: null }, later),
		).rejects.toMatchObject({ status: 423, response: { code: 'layout_locked', holderName: 'Moulik' } });
		expect((await service.layoutView(id, 'adm_2', later)).lock).toMatchObject({ holderId: 'adm_1', mine: false });
		// The holder saves; after two minutes without a beat the other admin may take it.
		await service.saveDraft('adm_1', id, { sections: [letter], expectedDraftId: null }, later);
		const quiet = new Date('2026-11-17T10:03:00.000Z');
		expect((await service.lock('adm_2', id, quiet)).granted).toBe(true);
		await service.unlock('adm_2', id);
		expect((await service.layoutView(id, 'adm_1', quiet)).lock).toBeNull();
	});
});

describe('saved blocks (SG-5, P7)', () => {
	const blockHarness = () => {
		const store = memoryLayouts();
		const saved = new Map<string, import('@saha-textile/contracts').SavedBlock>();
		const blocks = {
			list: async () => [...saved.values()],
			find: async (id: string) => saved.get(id) ?? null,
			save: async (block: import('@saha-textile/contracts').SavedBlock) => void saved.set(block.id, block),
			remove: async (id: string) => void saved.delete(id),
		};
		const audit = { append: vi.fn(async () => undefined) };
		const service = new PageBlocksService(
			blocks,
			store.repo,
			{ findById: async () => ({ displayName: 'Moulik' }) } as never,
			audit as never,
		);
		return { service, store, saved, audit };
	};

	it('saves a section as a block, counts the layouts linked to it, and refuses to delete one in use', async () => {
		const { service, store } = blockHarness();
		const made = await service.create('adm_1', { name: 'Join the list', section: letter });
		expect(made.block.section).toMatchObject({ id: made.block.id, type: 'newsletter', block: null });
		await store.repo.createLayout({
			id: 'lay_1',
			pageType: 'home',
			target: 'page',
			name: 'A',
			template: null,
			draftRevisionId: null,
			lastLiveRevisionId: null,
			createdAt: '2026-11-17T00:00:00.000Z',
			updatedAt: '2026-11-17T00:00:00.000Z',
			updatedBy: null,
			reviewRequest: null,
		});
		await store.repo.saveDraft({
			layoutId: 'lay_1',
			sections: [{ ...letter, block: { id: made.block.id, linked: true } }],
			expectedDraftId: null,
			by: null,
			at: '2026-11-17T00:00:00.000Z',
		});
		expect((await service.list())[0]).toMatchObject({ linkedUses: 1, updatedByName: 'Moulik' });
		await expect(service.remove('adm_1', made.block.id)).rejects.toMatchObject({
			status: 409,
			response: { code: 'block_in_use', linkedUses: 1 },
		});
		const changed = await service.update('adm_1', made.block.id, {
			name: 'Join us',
			section: section({ id: 'news', type: 'newsletter', title: { en: 'Join us', bn: 'যোগ দিন' } }),
		});
		expect(changed).toMatchObject({ linkedUses: 1, block: { name: 'Join us' } });
		await expect(service.update(null, 'blk_none', { name: 'x', section: letter })).rejects.toMatchObject({
			status: 404,
		});
	});
});

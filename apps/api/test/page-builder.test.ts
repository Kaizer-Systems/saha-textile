import {
	ARRANGEMENT_PIECES,
	type BuilderPage,
	type LayoutRevision,
	type MediaAsset,
	PageSection,
	type PageLayout,
	type PageTypeKey,
	type ScheduleEntry,
} from '@saha-textile/contracts';
import { ARRANGEMENT_PIECE_NAMES, type PageLayoutRepository, SECTION_COMMON_DEFAULTS } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { layoutMaxAge } from '../src/page-builder/page-builder.controller';
import { PageBuilderService, pictureFacts } from '../src/page-builder/page-builder.service';

/** An in-memory stand-in for the Page Builder store, with the same draft guard the Mongo adapter has. */
function memoryLayouts() {
	const pages = new Map<string, BuilderPage>();
	const layouts = new Map<string, PageLayout & { count: number }>();
	const revisions = new Map<string, LayoutRevision>();
	const repo: PageLayoutRepository = {
		page: async (type, target) => pages.get(`${type}:${target}`) ?? null,
		layouts: async (type, target) =>
			[...layouts.values()].filter((l) => l.pageType === type && l.target === target),
		layout: async (id) => layouts.get(id) ?? null,
		revision: async (id) => revisions.get(id) ?? null,
		revisions: async (layoutId) => [...revisions.values()].filter((r) => r.layoutId === layoutId).reverse(),
		createLayout: async (layout) => void layouts.set(layout.id, { ...layout, count: 0 }),
		renameLayout: async (id, name, template, by, at) => {
			const layout = layouts.get(id);
			if (layout) layouts.set(id, { ...layout, name, template, updatedBy: by, updatedAt: at });
		},
		saveDraft: async ({ layoutId, sections, expectedDraftId, by, at }) => {
			const layout = layouts.get(layoutId);
			if (!layout || layout.draftRevisionId !== expectedDraftId) return null;
			const revision: LayoutRevision = {
				id: `rev_${layout.count + 1}_${layoutId}`,
				layoutId,
				number: layout.count + 1,
				sections,
				createdAt: at,
				createdBy: by,
				wentLiveAt: null,
			};
			revisions.set(revision.id, revision);
			layouts.set(layoutId, {
				...layout,
				count: layout.count + 1,
				draftRevisionId: revision.id,
				updatedBy: by,
				updatedAt: at,
			});
			return revision;
		},
		goLive: async ({ pageType, target, entry, at }) => {
			const key = `${pageType}:${target}`;
			const page = pages.get(key) ?? { pageType, target, schedule: [], updatedAt: at };
			pages.set(key, { ...page, schedule: [...page.schedule, entry], updatedAt: at });
		},
		setSchedule: async (pageType, target, schedule, at) =>
			void pages.set(`${pageType}:${target}`, { pageType, target, schedule, updatedAt: at }),
		prune: async () => 0,
	};
	return { repo, pages, layouts, revisions };
}

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
		{ get: async () => switches.value } as never,
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
		const source = await service.createLayout('adm_1', 'home', { name: 'Source', start: 'blank', copyOf: null });
		await service.saveDraft('adm_1', source.layout.id, { sections: [letter], expectedDraftId: null });
		const copy = await service.createLayout('adm_1', 'home', {
			name: 'Winter weddings',
			start: 'copy',
			copyOf: source.layout.id,
		});
		expect(copy.draft?.sections).toEqual([letter]);
		expect(copy.layout).toMatchObject({
			name: 'Winter weddings',
			pageType: 'home',
			target: 'page',
			template: null,
		});
		const blank = await service.createLayout(null, 'home', { name: 'Empty', start: 'blank', copyOf: null });
		expect(blank.draft).toBeNull();
		expect(blank.problems).toEqual([{ kind: 'empty' }]);
		expect(audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'page_layout.create', entityType: 'page_layout' }),
		);
	});

	it('refuses a draft saved over a newer one, saying who saved it and when (FX-11)', async () => {
		const { service } = harness();
		const layout = await service.createLayout('adm_1', 'home', { name: 'Two tabs', start: 'blank', copyOf: null });
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
		const one = await making.service.createLayout(null, 'home', { name: 'Hero', start: 'blank', copyOf: null });
		const view = await making.service.saveDraft(null, one.layout.id, {
			sections: [banner('med_1', 'ver_1')],
			expectedDraftId: null,
		});
		expect(view.problems).toEqual([
			{ kind: 'picture_not_ready', sectionId: 'hero', piece: 'main', picture: 0, assetId: 'med_1' },
		]);

		const ready = harness(asset('ready'));
		const two = await ready.service.createLayout(null, 'home', { name: 'Hero', start: 'blank', copyOf: null });
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
		const layout = await service.createLayout('adm_1', 'home', { name: 'Old', start: 'blank', copyOf: null });
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
		});
		const created = await service.createLayout(null, 'home', { name: 'Hero', start: 'blank', copyOf: null });
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
});

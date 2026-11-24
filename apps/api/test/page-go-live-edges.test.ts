import { NotFoundException } from '@nestjs/common';
import { type MediaAsset, PageSection, type SavedBlock } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { PageBuilderService, pictureFacts } from '../src/page-builder/page-builder.service';
import { GO_LIVE_PERMISSION, PageGoLiveService } from '../src/page-builder/page-go-live.service';
import { memoryLayouts } from './page-builder-memory';

const OWNER = [GO_LIVE_PERMISSION, 'theme_option.index', 'theme_option.edit'];
const T0 = new Date('2026-11-17T10:00:00.000Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const section = (fields: Record<string, unknown>) => PageSection.parse(fields);
const letter = section({ id: 'news', type: 'newsletter', title: { en: 'Join', bn: 'যোগ দিন' } });
const row = (id: string) => section({ id, type: 'product_row', title: { en: 'New', bn: 'নতুন' } });
const banner = (href: string | null, assetId = 'med_ready') =>
	section({
		id: 'hero',
		type: 'banner_arrangement',
		pieces: [
			{
				name: 'main',
				pictures: [
					{
						images: { desktop: assetId },
						versions: { [assetId]: 'ver_1' },
						alt: { en: 'a', bn: 'b' },
						link: href ? { href, label: {} } : null,
					},
				],
			},
		],
	});

const photo = (id: string, state: 'ready' | 'making'): MediaAsset =>
	({
		id,
		deletedAt: null,
		width: 3380,
		height: 1000,
		processing: { state: 'ready' },
		versions: [{ id: 'ver_1', state }],
		derivatives: [{ role: 'banner', width: 1690, height: 500, versionId: 'ver_1', storageKey: 'k' }],
	}) as unknown as MediaAsset;

function harness(options: { superAdmin?: boolean; blocks?: SavedBlock[]; bare?: boolean } = {}) {
	const store = memoryLayouts();
	const photos = new Map<string, MediaAsset>([['med_ready', photo('med_ready', 'ready')]]);
	const settings = new Map<string, unknown>();
	const audit = { append: vi.fn(async () => undefined) };
	const queue = { enqueue: vi.fn(async () => undefined) };
	const settingsRepo = {
		get: vi.fn(async (key: string) =>
			settings.has(key) ? settings.get(key) : key === 'storefront.home' ? {} : null,
		),
		set: vi.fn(async (key: string, value: unknown) => void settings.set(key, value)),
	};
	const builder = new PageBuilderService(
		store.repo,
		LanguageStore.fixed(['en', 'bn']),
		{
			findById: async (id: string) => (id === 'adm_1' ? { displayName: 'Moulik' } : { displayName: 'Rina' }),
		} as never,
		{
			findById: async (id: string) => photos.get(id) ?? null,
			findManyByIds: async (ids: string[]) => ids.flatMap((id) => photos.get(id) ?? []),
		} as never,
		{ getUrl: (key: string) => `https://cdn/${key}` } as never,
		settingsRepo as never,
		{ list: async () => [] } as never,
		audit as never,
		queue,
	);
	const goLive = new PageGoLiveService(
		store.repo,
		{ list: async () => options.blocks ?? [] },
		builder,
		LanguageStore.fixed(['en', 'bn']),
		settingsRepo as never,
		{
			findBySlug: async (slug: string) =>
				options.bare
					? Promise.reject(new Error('down'))
					: slug === 'red-saree'
						? ({ id: 'prd_1' } as never)
						: null,
		},
		{
			findBySlug: async (slug: string) =>
				options.bare
					? Promise.reject(new Error('down'))
					: slug === 'winter-care'
						? ({ status: 'live', publishedAt: '2026-11-01T00:00:00.000Z' } as never)
						: slug === 'draft-post'
							? ({ status: 'draft', publishedAt: null } as never)
							: null,
		},
		{ findByKey: async () => ({ id: 'role_admin' }) as never },
		{ findActive: async () => (options.superAdmin ? ({ id: 'as_1' } as never) : null) },
		options.bare ? null : { listLivePaths: async () => ['sarees', 'sarees/banarasi'] },
		options.bare
			? null
			: {
					paidTotalsBetween: async (from: string, to: string) =>
						// One paid order of ₹2,500 an hour in this stand-in.
						({
							orders: Math.floor((Date.parse(to) - Date.parse(from)) / 3_600_000),
							totalINR: 2500 * Math.floor((Date.parse(to) - Date.parse(from)) / 3_600_000),
						}),
				},
	);
	const filledSettings = () =>
		store.repo.saveSettings(
			'home',
			'page',
			{
				title: { en: 'Sarees', bn: 'শাড়ি' },
				description: { en: 'Woven', bn: 'বোনা' },
				heading: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
				headingShown: false,
				shareImage: null,
			},
			T0.toISOString(),
		);
	/** A layout with a saved draft; answers its id and the draft's id. */
	const layout = async (name: string, sections: PageSection[]) => {
		const created = await builder.createLayout('adm_2', 'home', {
			name,
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		const saved = await builder.saveDraft('adm_2', created.layout.id, { sections, expectedDraftId: null }, T0);
		return { id: created.layout.id, draft: saved.draft?.id ?? '' };
	};
	return { store, builder, goLive, settings, photos, audit, queue, filledSettings, layout };
}

type Harness = ReturnType<typeof harness>;

const request = (draft: string, over: Record<string, unknown> = {}) => ({
	expectedDraftId: draft,
	from: null,
	until: null,
	handBackTo: null,
	whenReady: false,
	...over,
});
/** A layout put straight into the store, for shapes the builder would not make. */
const rawLayout = (h: Harness, id: string, over: Record<string, unknown> = {}) =>
	h.store.layouts.set(id, {
		id,
		pageType: 'home',
		target: 'page',
		name: id,
		template: null,
		draftRevisionId: null,
		lastLiveRevisionId: null,
		reviewRequest: null,
		createdAt: T0.toISOString(),
		updatedAt: T0.toISOString(),
		updatedBy: null,
		count: 0,
		...over,
	} as never);
const blank = async (h: Harness, name: string) =>
	(
		await h.builder.createLayout('adm_2', 'home', {
			name,
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		})
	).layout.id;
/** A layout that went live now, by the owner. */
const liveLayout = async (h: Harness, name: string) => {
	const made = await h.layout(name, [letter]);
	await h.goLive.goLive('adm_1', made.id, request(made.draft), OWNER, T0);
	return made;
};
const pending = (revisionId: string, layoutId: string, from: string, until: string | null = null) => ({
	entry: { revisionId, layoutId, from, until, by: 'adm_1' },
	handBack: null,
	requestedAt: T0.toISOString(),
});

describe('Go Live checks: the remaining cases', () => {
	it('finds no live page behind a link when the stores fail, or when there is no collection list', async () => {
		const h = harness({ bare: true });
		await h.filledSettings();
		const links = ['/product/red-saree', '/collections/sarees', '/blog/winter-care'];
		const { id } = await h.layout(
			'Links',
			links.map((href, index) => ({ ...banner(href), id: `hero_${index}` }) as PageSection),
		);
		const view = await h.goLive.view(id, OWNER, T0);
		expect(view.problems.filter((problem) => problem.kind === 'link_gone').map((problem) => problem.href)).toEqual(
			links,
		);
	});

	it('checks nothing for a page type that is not registered, and refuses to open one, or a layout with no id', async () => {
		const h = harness();
		expect(await h.goLive.problems('retired' as never, [], T0)).toEqual([]);
		rawLayout(h, 'lay_retired', { pageType: 'retired' });
		await expect(h.goLive.view('lay_retired', OWNER, T0)).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.goLive.cancelWaiting(null, 'retired', 'x', T0)).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.goLive.history('', T0)).rejects.toBeInstanceOf(NotFoundException);
	});

	it('views a layout with no draft, naming the layout showing now and offering to hand back to it', async () => {
		const h = harness();
		await h.filledSettings();
		const shown = await liveLayout(h, 'Everyday');
		const other = await blank(h, 'Blank');
		const view = await h.goLive.view(other, OWNER, T0);
		expect(view).toMatchObject({ draftRevisionId: null, liveLayoutName: 'Everyday', naturalHandBack: shown.id });
		expect((await h.goLive.view(shown.id, OWNER, T0)).naturalHandBack).toBeNull();
		h.store.layouts.delete(shown.id);
		expect((await h.goLive.view(other, OWNER, T0)).liveLayoutName).toBeNull();
	});

	it('lists a linked block whose block is saved, not one whose block is gone, reading layouts without drafts', async () => {
		const block: SavedBlock = {
			id: 'blk_puja',
			name: 'Durga Puja promo',
			section: { ...letter, id: 'blk_puja' } as PageSection,
			createdAt: T0.toISOString(),
			updatedAt: T0.toISOString(),
			updatedBy: null,
		};
		const h = harness({ blocks: [block] });
		await h.filledSettings();
		await blank(h, 'Empty');
		const sections = [
			{ ...letter, block: { id: 'blk_puja', linked: true } },
			{ ...row('row_1'), block: { id: 'blk_gone', linked: true } },
		] as PageSection[];
		const { id } = await h.layout('Puja', sections);
		expect((await h.goLive.view(id, OWNER, T0)).linkedBlocks).toEqual([
			{ blockId: 'blk_puja', name: 'Durga Puja promo', layouts: ['Puja'] },
		]);
	});
});

describe('Go Live: the remaining cases', () => {
	it('refuses a draft that is gone', async () => {
		const h = harness();
		rawLayout(h, 'lay_x', { draftRevisionId: 'rev_gone' });
		await expect(h.goLive.goLive('adm_1', 'lay_x', request('rev_gone'), OWNER, T0)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('refuses when the revision holding linked blocks is saved over meanwhile', async () => {
		const block: SavedBlock = {
			id: 'blk_puja',
			name: 'Durga Puja promo',
			section: { ...letter, id: 'blk_puja', title: { en: 'Puja offers', bn: 'পুজোর অফার' } } as PageSection,
			createdAt: T0.toISOString(),
			updatedAt: T0.toISOString(),
			updatedBy: null,
		};
		const h = harness({ blocks: [block] });
		await h.filledSettings();
		const { id, draft } = await h.layout('Puja', [
			{ ...letter, block: { id: 'blk_puja', linked: true } } as PageSection,
		]);
		h.store.repo.saveDraft = async () => null;
		await expect(h.goLive.goLive('adm_1', id, request(draft), OWNER, T0)).rejects.toMatchObject({ status: 409 });
	});

	it('refuses a hand-back to a layout that is unknown, of another page, never live, or itself', async () => {
		const h = harness();
		await h.filledSettings();
		const shown = await liveLayout(h, 'Everyday');
		const next = await h.layout('Festive', [letter]);
		rawLayout(h, 'lay_other_page', { pageType: 'about', lastLiveRevisionId: 'rev_x' });
		const never = await blank(h, 'Never live');
		const until = later(60).toISOString();
		for (const handBackTo of ['lay_none', 'lay_other_page', never]) {
			await expect(
				h.goLive.goLive('adm_1', next.id, request(next.draft, { until, handBackTo }), OWNER, T0),
			).rejects.toMatchObject({
				response: { code: 'hand_back_refused' },
			});
		}
		await expect(
			h.goLive.goLive('adm_1', shown.id, request(shown.draft, { until, handBackTo: shown.id }), OWNER, T0),
		).rejects.toMatchObject({ response: { code: 'hand_back_refused' } });
	});
});

describe('waiting Go Lives and the schedule: the remaining cases', () => {
	it('settles nothing when nothing waits', async () => {
		expect(await harness().goLive.settleWaiting(T0)).toBe(0);
	});

	it('drops a waiting Go Live whose revision is gone or whose end has passed, and keeps a later start as asked', async () => {
		const h = harness();
		await h.filledSettings();
		const { id, draft } = await h.layout('Everyday', [letter]);
		await h.store.repo.setPending(
			'home',
			'page',
			[
				pending('rev_gone', id, T0.toISOString()),
				pending(draft, id, later(-120).toISOString(), later(-60).toISOString()),
				pending(draft, id, later(60).toISOString()),
			],
			T0.toISOString(),
		);
		expect(await h.goLive.settleWaiting(T0)).toBe(1);
		const page = h.store.pages.get('home:page');
		expect(page?.pending).toEqual([]);
		expect(page?.schedule.map((entry) => entry.from)).toEqual([later(60).toISOString()]);
	});

	it('takes a waiting Go Live off, and refuses when nothing waits for that layout', async () => {
		const h = harness();
		await expect(h.goLive.cancelWaiting('adm_1', 'home', 'lay_x', T0)).rejects.toBeInstanceOf(NotFoundException);
		const { id, draft } = await h.layout('Everyday', [letter]);
		await h.store.repo.setPending('home', 'page', [pending(draft, id, T0.toISOString())], T0.toISOString());
		await h.goLive.cancelWaiting('adm_1', 'home', id, T0);
		expect(h.store.pages.get('home:page')?.pending).toEqual([]);
	});

	it('refuses to cancel or put back on a page with no schedule, and safe mode for nobody', async () => {
		const h = harness({ superAdmin: true });
		await expect(
			h.goLive.cancelSwitch(null, 'home', { revisionId: 'rev_1', from: T0.toISOString() }, T0),
		).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.goLive.putBack(null, 'home', T0)).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.goLive.safeMode(null, 'home', true, T0)).rejects.toMatchObject({ status: 403 });
	});
});

describe('History, export, sales and the bell: the remaining cases', () => {
	it('shows no revision as live while the page is in safe mode, or before the page exists', async () => {
		const h = harness({ superAdmin: true });
		await h.filledSettings();
		const shown = await liveLayout(h, 'Everyday');
		await h.goLive.safeMode('adm_1', 'home', true, T0);
		expect((await h.goLive.history(shown.id, T0)).revisions.every((revision) => !revision.isLive)).toBe(true);

		const fresh = harness();
		fresh.settings.set('storefront.pageBuilder', { home: true });
		const id = await blank(fresh, 'Blank');
		expect((await fresh.goLive.history(id, T0)).revisions).toEqual([]);
	});

	it('exports a layout with neither a draft nor a live revision as empty', async () => {
		const h = harness();
		const id = await blank(h, 'Blank');
		expect((await h.goLive.export(id, T0)).sections).toEqual([]);
	});

	it('totals nothing without an order store, names a layout that is gone by its id, and lists no stretch for a new page', async () => {
		const h = harness({ bare: true });
		await h.filledSettings();
		const shown = await liveLayout(h, 'Everyday');
		h.store.layouts.delete(shown.id);
		const sales = await h.goLive.sales('home', later(60));
		expect(sales.rows).toEqual([
			expect.objectContaining({ layoutId: shown.id, layoutName: shown.id, orders: 0, totalINR: 0 }),
		]);
		expect((await harness().goLive.sales('home', T0)).rows).toEqual([]);
	});

	it('closes a review for a reviewer, and draws a bare request with the layout’s own time', async () => {
		const h = harness();
		const { id } = await h.layout('Everyday', [letter]);
		await h.goLive.askReview('adm_2', id, 'Please check', T0);
		await h.goLive.closeReview('adm_1', id, OWNER);
		expect(h.store.layouts.get(id)?.reviewRequest).toBeNull();
		await h.store.repo.setReviewRequest(id, {} as never);
		const [line] = (await h.goLive.alerts(OWNER)).reviews;
		expect(line).toMatchObject({ layoutId: id, at: h.store.layouts.get(id)?.updatedAt, note: '' });
	});

	it('checks each scheduled revision once, counting a gone revision as a problem and naming a gone layout by its id', async () => {
		const h = harness();
		const entry = (revisionId: string, from: Date) => ({
			revisionId,
			layoutId: 'lay_gone',
			from: from.toISOString(),
			until: null,
			by: 'adm_1',
		});
		await h.store.repo.setSchedule(
			'home',
			'page',
			[entry('rev_old', later(-120)), entry('rev_gone', later(-60)), entry('rev_gone', later(60))],
			T0.toISOString(),
		);
		expect(await h.goLive.nightlyCheck(T0)).toBe(1);
		expect(h.settings.get('page_builder_nightly_check')).toMatchObject({
			layouts: [{ layoutId: 'lay_gone', layoutName: 'lay_gone', problems: 1 }],
		});
	});
});

describe('the page builder service: the remaining cases', () => {
	const asset = (id: string, over: Record<string, unknown> = {}) =>
		({
			id,
			deletedAt: null,
			width: 3380,
			height: 1000,
			processing: { state: 'ready' },
			versions: [{ id: 'ver_1', state: 'ready' }],
			derivatives: [],
			...over,
		}) as unknown as MediaAsset;
	const worded = (id: string, assetId: string) =>
		section({
			id,
			type: 'banner_arrangement',
			pieces: [
				{
					name: 'main',
					pictures: [
						{
							images: { desktop: assetId },
							versions: { [assetId]: 'ver_1' },
							alt: { en: 'a', bn: 'b' },
							heading: { en: 'Made for evenings', bn: 'সন্ধ্যার জন্য' },
						},
					],
				},
			],
		});

	it('reads a picture’s facts: no version list, and a shape from the photo when it has no files', () => {
		expect(pictureFacts(asset('med_a', { versions: undefined }), 'ver_1')).toBeNull();
		expect(pictureFacts(asset('med_a'), null)).toEqual({ ready: true, ratio: 3.38, wordSpots: false });
		expect(pictureFacts(asset('med_a', { width: null }), null)?.ratio).toBeNull();
	});

	it('names a waiting Go Live of a layout that is gone with no name', async () => {
		const h = harness();
		await h.store.repo.setPending(
			'home',
			'page',
			[pending('rev_x', 'lay_gone', T0.toISOString())],
			T0.toISOString(),
		);
		expect((await h.builder.page('home', T0)).waiting).toEqual([
			expect.objectContaining({ layoutId: 'lay_gone', layoutName: '' }),
		]);
	});

	it('lists switches still ahead soonest first, a showing one by its end or, without one, its start', async () => {
		const h = harness();
		const { id, draft } = await h.layout('Everyday', [letter]);
		const entry = (from: Date, until: Date | null) => ({
			revisionId: draft,
			layoutId: id,
			from: from.toISOString(),
			until: until ? until.toISOString() : null,
			by: 'adm_1',
		});
		await h.store.repo.setSchedule(
			'home',
			'page',
			[entry(later(-60), later(120)), entry(later(60), null)],
			T0.toISOString(),
		);
		const ended = await h.builder.comingUp(T0);
		expect(ended.rows.length).toBeGreaterThan(0);
		await h.store.repo.setSchedule(
			'home',
			'page',
			[entry(later(-60), null), entry(later(60), null)],
			T0.toISOString(),
		);
		expect((await h.builder.comingUp(T0)).rows.length).toBeGreaterThan(0);
	});

	it('draws the page’s share picture from its largest file, and nothing for a photo gone, deleted or unreadable', async () => {
		const h = harness();
		const share = async (assetId: string) => {
			await h.store.repo.saveSettings(
				'home',
				'page',
				{ ...NO_SETTINGS_FILLED, shareImage: { assetId, versionId: null } },
				T0.toISOString(),
			);
			return (await h.builder.page('home', T0)).shareImageUrl;
		};
		h.photos.set('med_public', {
			...photo('med_public', 'ready'),
			visibility: 'public',
			text: { alt: {} },
		} as unknown as MediaAsset);
		expect(await share('med_public')).toBe('https://cdn/k');
		expect(await share('med_gone')).toBeNull();
		h.photos.set('med_deleted', asset('med_deleted', { deletedAt: T0.toISOString() }));
		expect(await share('med_deleted')).toBeNull();
		h.photos.set('med_empty', asset('med_empty'));
		expect(await share('med_empty')).toBeNull();
		Object.defineProperty(h.builder, 'assets', {
			value: { findById: async () => Promise.reject(new Error('down')), findManyByIds: async () => [] },
		});
		expect(await share('med_ready')).toBeNull();
	});

	it('copies another layout’s last live revision, or nothing, and refuses a copy of nothing, another page or a missing template', async () => {
		const h = harness();
		const { draft } = await h.layout('Everyday', [letter]);
		rawLayout(h, 'lay_live_only', { lastLiveRevisionId: draft });
		rawLayout(h, 'lay_empty');
		rawLayout(h, 'lay_about', { pageType: 'about' });
		const ask = (over: Record<string, unknown>) =>
			h.builder.createLayout('adm_1', 'home', {
				name: 'Copy',
				start: 'copy',
				copyOf: null,
				template: null,
				bringPictures: false,
				...over,
			} as never);
		expect((await ask({ copyOf: 'lay_live_only' })).draft?.sections).toEqual([letter]);
		expect((await ask({ copyOf: 'lay_empty' })).draft?.sections ?? []).toEqual([]);
		await expect(ask({})).rejects.toBeInstanceOf(NotFoundException);
		await expect(ask({ copyOf: 'lay_about' })).rejects.toBeInstanceOf(NotFoundException);
		await expect(ask({ start: 'template' })).rejects.toBeInstanceOf(NotFoundException);
	});

	it('opens a layout of a page type no longer registered with nothing to add and nothing holding it', async () => {
		const h = harness();
		rawLayout(h, 'lay_retired', { pageType: 'retired' });
		expect(await h.builder.layoutView('lay_retired')).toMatchObject({ allowedSections: [], problems: [] });
		expect(await h.builder.problemsFor('retired' as never, [letter])).toEqual([]);
	});

	it('checks words only over pictures that are ready, reads a picture with no version named, and asks for each measure once', async () => {
		const h = harness();
		h.photos.set('med_making', photo('med_making', 'making'));
		h.queue.enqueue.mockRejectedValue(new Error('queue down'));
		const plain = section({
			id: 'plain',
			type: 'banner_arrangement',
			pieces: [
				{
					name: 'main',
					pictures: [{ images: { desktop: 'med_ready' }, versions: {}, alt: { en: 'a', bn: 'b' } }],
				},
			],
		});
		const problems = await h.builder.problemsFor('home', [
			worded('w1', 'med_making'),
			worded('w2', 'med_none'),
			worded('w3', 'med_ready'),
			worded('w4', 'med_ready'),
			plain,
		]);
		expect(problems.filter((problem) => problem.kind === 'words_unmeasured')).toHaveLength(2);
		expect(h.queue.enqueue).toHaveBeenCalledTimes(1);
	});

	it('warms nothing for a page with no schedule, and carries on when the queue fails', async () => {
		const h = harness();
		expect(await h.builder.warmSwitches('about', T0)).toBe(0);
		h.queue.enqueue.mockRejectedValueOnce(new Error('queue down'));
		expect(await h.builder.warmSwitches('home', T0, true)).toBe(1);
	});

	it('maps words over a small photo, a phone photo that cannot be measured, and skips a photo that cannot be read', async () => {
		const h = harness();
		h.photos.set(
			'med_small',
			asset('med_small', {
				derivatives: [
					{ role: 'banner', width: 300, height: 100, versionId: 'ver_1', storageKey: 'small-300' },
					{ role: 'banner', width: 200, height: 66, versionId: 'ver_1', storageKey: 'small-200' },
				],
			}),
		);
		h.photos.set('med_bare', asset('med_bare', { versions: undefined }));
		h.queue.enqueue.mockRejectedValueOnce(new Error('queue down'));
		const map = await h.builder.wordsMap({
			desktop: 'med_small',
			desktopVersion: 'ver_1',
			phone: 'med_bare',
		} as never);
		expect(map.bands).toEqual([
			expect.objectContaining({ band: 'desktop', url: 'https://cdn/small-300', state: 'measuring' }),
			expect.objectContaining({ band: 'phone', versionId: null, url: null, state: 'unmeasurable' }),
		]);
		Object.defineProperty(h.builder, 'assets', {
			value: { findById: async () => Promise.reject(new Error('down')) },
		});
		expect((await h.builder.wordsMap({ desktop: 'med_small' } as never)).bands).toEqual([]);
	});

	it('refuses a lock for nobody or for a layout gone meanwhile; unlocking for nobody does nothing', async () => {
		const h = harness();
		const { id } = await h.layout('Everyday', [letter]);
		await expect(h.builder.lock(null, id, T0)).rejects.toBeInstanceOf(NotFoundException);
		h.store.repo.lock = async () => null;
		await expect(h.builder.lock('adm_1', id, T0)).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.builder.unlock(null, id)).resolves.toBeUndefined();
	});

	it('draws no picture for a photo that is gone or deleted', async () => {
		const h = harness();
		h.photos.set('med_deleted', asset('med_deleted', { deletedAt: T0.toISOString() }));
		const drawn = await h.builder.drawn(
			'home',
			{
				id: 'rev_1',
				sections: [
					{ ...banner(null, 'med_gone'), id: 'h1' },
					{ ...banner(null, 'med_deleted'), id: 'h2' },
				] as PageSection[],
			},
			[],
			'en',
			T0,
			null as never,
		);
		expect(drawn).toMatchObject({ pageType: 'home', revisionId: 'rev_1' });
	});

	it('names an admin by display name, user name or email, nobody when unknown or unreadable, and records nothing without an audit store', async () => {
		const h = harness();
		const findById = vi
			.fn()
			.mockResolvedValueOnce({ displayName: null, username: 'rina' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: 'rina@example.test' })
			.mockResolvedValueOnce({ displayName: null, username: null, email: null })
			.mockRejectedValueOnce(new Error('down'));
		Object.defineProperty(h.builder, 'admins', { value: { findById } });
		expect(await h.builder.adminName('adm_x')).toBe('rina');
		expect(await h.builder.adminName('adm_x')).toBe('rina@example.test');
		expect(await h.builder.adminName('adm_x')).toBeNull();
		expect(await h.builder.adminName('adm_x')).toBeNull();
		Object.defineProperty(h.builder, 'audit', { value: null });
		await h.builder.record('adm_1', 'page_layout.test', 'lay_1', {});
		expect(h.audit.append).not.toHaveBeenCalled();
	});
});

const NO_SETTINGS_FILLED = {
	title: { en: 'Sarees', bn: 'শাড়ি' },
	description: { en: 'Woven', bn: 'বোনা' },
	heading: { en: 'Saha Textile', bn: 'সাহা টেক্সটাইল' },
	headingShown: false,
	shareImage: null,
};

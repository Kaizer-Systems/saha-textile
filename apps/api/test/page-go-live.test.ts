import { type MediaAsset, PageSection, SECTION_DEFINITIONS, type SavedBlock } from '@saha-textile/contracts';
import { SECTION_BUDGETS } from '@saha-textile/core-domain';
import { describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { PageBuilderService } from '../src/page-builder/page-builder.service';
import { GO_LIVE_PERMISSION, PageGoLiveService } from '../src/page-builder/page-go-live.service';
import { memoryLayouts } from './page-builder-memory';

const OWNER = [GO_LIVE_PERMISSION, 'theme_option.index', 'theme_option.edit'];
const STAFF = ['theme_option.index', 'theme_option.edit'];
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

function harness(options: { superAdmin?: boolean; blocks?: SavedBlock[] } = {}) {
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
		{ findBySlug: async (slug: string) => (slug === 'red-saree' ? ({ id: 'prd_1' } as never) : null) },
		{
			findBySlug: async (slug: string) =>
				slug === 'winter-care'
					? ({ status: 'live', publishedAt: '2026-11-01T00:00:00.000Z' } as never)
					: slug === 'draft-post'
						? ({ status: 'draft', publishedAt: null } as never)
						: null,
		},
		{ findByKey: async () => ({ id: 'role_admin' }) as never },
		{ findActive: async () => (options.superAdmin ? ({ id: 'as_1' } as never) : null) },
		{ listLivePaths: async () => ['sarees', 'sarees/banarasi'] },
		{
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

describe('Go Live checks (E1, P6, SG-9, SG-13, SG-16)', () => {
	it('keeps core’s written-out section budgets equal to the contract’s (core reads contracts as types only)', () => {
		for (const [type, definition] of Object.entries(SECTION_DEFINITIONS)) {
			const { browserFilled: _filled, ...budget } = definition.budget;
			expect(SECTION_BUDGETS[type as keyof typeof SECTION_BUDGETS]).toEqual(budget);
		}
	});

	it('lists what holds Go Live: the main heading in every language and links to pages off the shop', async () => {
		const h = harness();
		const { id } = await h.layout('Winter weddings', [banner('/bn/collections/winter-shawls'), letter]);
		const view = await h.goLive.view(id, STAFF, T0);
		expect(view.canGoLive).toBe(false);
		expect(view.problems).toEqual(
			expect.arrayContaining([
				{
					kind: 'link_gone',
					sectionId: 'hero',
					piece: 'main',
					picture: 0,
					href: '/bn/collections/winter-shawls',
				},
				{ kind: 'page_settings', locale: 'en', field: 'title' },
				{ kind: 'page_settings', locale: 'bn', field: 'heading' },
			]),
		);
		expect(view.changes).toMatchObject({ firstTime: true, newPictures: 1 });
		expect(view.summary).toEqual({ sections: 2, sliders: 0, sliderPictures: 0, earlyPictures: 1 });
		expect(view.budget.map((line) => line.key)).toEqual([
			'early_pictures',
			'first_load_code',
			'html',
			'later_code',
		]);
	});

	it('finds live products, collections, published posts and fixed pages; refuses the rest', async () => {
		const h = harness();
		await h.filledSettings();
		const links = [
			'/en/product/red-saree',
			'/collections/sarees/banarasi?sort=new',
			'/blog/winter-care',
			'/bn/contact-us',
			'/',
			'https://instagram.com/x',
			'/product/gone',
			'/blog/draft-post',
			'/colections/sarees',
		];
		const sections = links.map((href, index) => ({ ...banner(href), id: `hero_${index}` }) as PageSection);
		const { id } = await h.layout('Links', sections);
		const view = await h.goLive.view(id, OWNER, T0);
		const gone = view.problems.filter((problem) => problem.kind === 'link_gone').map((problem) => problem.href);
		expect(gone).toEqual(['/product/gone', '/blog/draft-post', '/colections/sarees']);
	});
});

describe('Go Live (E2, Q10 A)', () => {
	it('is refused without the permission, over a newer draft, and while something holds it', async () => {
		const h = harness();
		const { id, draft } = await h.layout('Everyday', [letter]);
		const now = { expectedDraftId: draft, from: null, until: null, handBackTo: null, whenReady: false };
		await expect(h.goLive.goLive('adm_2', id, now, STAFF, T0)).rejects.toMatchObject({ status: 403 });
		await expect(
			h.goLive.goLive('adm_1', id, { ...now, expectedDraftId: 'rev_old' }, OWNER, T0),
		).rejects.toMatchObject({
			status: 409,
		});
		// The main heading is still empty in both languages.
		await expect(h.goLive.goLive('adm_1', id, now, OWNER, T0)).rejects.toMatchObject({
			status: 400,
			response: { code: 'go_live_refused' },
		});
	});

	it('goes live now: the schedule, the switch, the review request and the audit line', async () => {
		const h = harness();
		await h.filledSettings();
		const { id, draft } = await h.layout('Everyday', [letter]);
		await h.goLive.askReview('adm_2', id, 'Ready for Monday', T0);
		expect((await h.goLive.alerts(OWNER)).reviews).toEqual([
			{
				layoutId: id,
				pageType: 'home',
				layoutName: 'Everyday',
				byName: 'Rina',
				at: T0.toISOString(),
				note: 'Ready for Monday',
			},
		]);
		expect((await h.goLive.alerts(STAFF)).reviews).toEqual([]);
		const done = await h.goLive.goLive(
			'adm_1',
			id,
			{ expectedDraftId: draft, from: null, until: null, handBackTo: null, whenReady: false },
			OWNER,
			T0,
		);
		expect(done.state).toBe('live');
		expect(done.page).toMatchObject({ builderOn: true, liveRevisionId: draft });
		expect(h.settings.get('storefront.pageBuilder')).toEqual({ home: true });
		expect((await h.store.repo.revision(draft))?.wentLiveAt).toBe(T0.toISOString());
		expect((await h.goLive.alerts(OWNER)).reviews).toEqual([]);
		expect(h.audit.append).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'page_layout.go_live', entityId: id }),
		);
		// The shop draws it.
		expect((await h.builder.shopLayout('home', 'en', later(1))).revisionId).toBe(draft);
	});

	it('schedules a switch with an end that hands back to the chosen layout, and refuses a start in the past', async () => {
		const h = harness();
		await h.filledSettings();
		const today = await h.layout('Today’s home page', [letter]);
		const base = { from: null, until: null, handBackTo: null, whenReady: false };
		await h.goLive.goLive('adm_1', today.id, { ...base, expectedDraftId: today.draft }, OWNER, T0);
		const winter = await h.layout('Winter weddings', [row('new'), letter]);
		const from = later(60).toISOString();
		const until = later(120).toISOString();
		const scheduled = await h.goLive.goLive(
			'adm_1',
			winter.id,
			{ ...base, expectedDraftId: winter.draft, from, until, handBackTo: today.id },
			OWNER,
			T0,
		);
		expect(scheduled.state).toBe('scheduled');
		expect(scheduled.page.schedule.map((entry) => [entry.layoutId, entry.from, entry.until])).toEqual([
			[today.id, T0.toISOString(), null],
			[winter.id, from, until],
			[today.id, until, null],
		]);
		await expect(
			h.goLive.goLive(
				'adm_1',
				winter.id,
				{ ...base, expectedDraftId: winter.draft, from: later(-10).toISOString() },
				OWNER,
				T0,
			),
		).rejects.toMatchObject({ response: { code: 'starts_in_past' } });
		// Cancel the switch still to come; the one showing cannot be cancelled.
		const cancelled = await h.goLive.cancelSwitch('adm_1', 'home', { revisionId: winter.draft, from }, T0);
		expect(cancelled.schedule.map((entry) => entry.layoutId)).toEqual([today.id, today.id]);
		await expect(
			h.goLive.cancelSwitch('adm_1', 'home', { revisionId: today.draft, from: T0.toISOString() }, T0),
		).rejects.toMatchObject({ status: 404 });
	});

	it('draws linked blocks into a revision of their own, and that revision goes live (SG-5)', async () => {
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
		const linked = { ...letter, block: { id: 'blk_puja', linked: true } } as PageSection;
		const { id, draft } = await h.layout('Puja', [linked]);
		const view = await h.goLive.view(id, OWNER, T0);
		expect(view.linkedBlocks).toEqual([{ blockId: 'blk_puja', name: 'Durga Puja promo', layouts: ['Puja'] }]);
		const done = await h.goLive.goLive(
			'adm_1',
			id,
			{ expectedDraftId: draft, from: null, until: null, handBackTo: null, whenReady: false },
			OWNER,
			T0,
		);
		const live = await h.store.repo.revision(done.page.liveRevisionId ?? '');
		expect(live?.id).not.toBe(draft);
		expect(live?.sections[0]).toMatchObject({ id: 'news', title: { en: 'Puja offers' } });
	});
});

describe('Go Live by itself when pictures are ready (E5)', () => {
	it('waits while a picture is being made, then goes live on the next settle; Wait takes it off', async () => {
		const h = harness();
		await h.filledSettings();
		h.photos.set('med_making', photo('med_making', 'making'));
		const { id, draft } = await h.layout('New hero', [banner(null, 'med_making')]);
		const view = await h.goLive.view(id, OWNER, T0);
		expect(view).toMatchObject({ problems: [], waitingPictures: 1 });
		const request = { expectedDraftId: draft, from: null, until: null, handBackTo: null, whenReady: false };
		await expect(h.goLive.goLive('adm_1', id, request, OWNER, T0)).rejects.toMatchObject({ status: 400 });
		const waiting = await h.goLive.goLive('adm_1', id, { ...request, whenReady: true }, OWNER, T0);
		expect(waiting.state).toBe('waiting');
		expect(waiting.page.waiting).toEqual([
			{ layoutId: id, layoutName: 'New hero', from: T0.toISOString(), requestedAt: T0.toISOString() },
		]);
		expect(await h.goLive.settleWaiting(later(1))).toBe(0);
		h.photos.set('med_making', photo('med_making', 'ready'));
		expect(await h.goLive.settleWaiting(later(2))).toBe(1);
		const page = await h.builder.page('home', later(3));
		expect(page).toMatchObject({ waiting: [], liveRevisionId: draft, builderOn: true });
		expect(page.schedule[0]?.from).toBe(later(2).toISOString());

		await h.goLive.goLive('adm_1', id, { ...request, whenReady: true }, OWNER, later(3)).catch(() => null);
		await expect(h.goLive.cancelWaiting('adm_1', 'home', 'lay_none', later(4))).rejects.toMatchObject({
			status: 404,
		});
	});
});

describe('History, Put back and safe mode (E3, SG-15)', () => {
	it('lists revisions newest first with the one showing, and brings one back as a new draft', async () => {
		const h = harness();
		await h.filledSettings();
		const { id, draft } = await h.layout('Everyday', [letter]);
		await h.goLive.goLive(
			'adm_1',
			id,
			{ expectedDraftId: draft, from: null, until: null, handBackTo: null, whenReady: false },
			OWNER,
			T0,
		);
		const second = await h.builder.saveDraft(
			'adm_2',
			id,
			{ sections: [row('new'), letter], expectedDraftId: draft },
			later(1),
		);
		const history = await h.goLive.history(id, later(2));
		expect(history.revisions.map((revision) => [revision.number, revision.isDraft, revision.isLive])).toEqual([
			[2, true, false],
			[1, false, true],
		]);
		expect(history.revisions[1]).toMatchObject({
			createdByName: 'Rina',
			wentLiveAt: T0.toISOString(),
			sections: 1,
		});
		const back = await h.goLive.bringBack(
			'adm_2',
			id,
			{ revisionId: draft, expectedDraftId: second.draft?.id ?? null },
			later(3),
		);
		expect(back.draft).toMatchObject({ number: 3, sections: [letter] });
		await expect(
			h.goLive.bringBack('adm_2', id, { revisionId: 'rev_other', expectedDraftId: null }),
		).rejects.toMatchObject({
			status: 404,
		});
	});

	it('puts back the layout that showed before, in one step', async () => {
		const h = harness();
		await h.filledSettings();
		const base = { from: null, until: null, handBackTo: null, whenReady: false };
		const today = await h.layout('Today’s home page', [letter]);
		await h.goLive.goLive('adm_1', today.id, { ...base, expectedDraftId: today.draft }, OWNER, T0);
		const puja = await h.layout('Puja', [row('new'), letter]);
		await h.goLive.goLive('adm_1', puja.id, { ...base, expectedDraftId: puja.draft }, OWNER, later(5));
		const before = await h.builder.page('home', later(6));
		expect(before.putBack).toEqual({
			layoutId: today.id,
			layoutName: 'Today’s home page',
			revisionId: today.draft,
		});
		const after = await h.goLive.putBack('adm_1', 'home', later(7));
		expect(after.liveRevisionId).toBe(today.draft);
		expect(after.putBack?.layoutId).toBe(puja.id);
	});

	it('lets only super admins put a page on the fixed code; Go Live does not undo it', async () => {
		const staff = harness();
		await expect(staff.goLive.safeMode('adm_1', 'home', true, T0)).rejects.toMatchObject({ status: 403 });
		const h = harness({ superAdmin: true });
		await h.filledSettings();
		const { id, draft } = await h.layout('Everyday', [letter]);
		await h.goLive.goLive(
			'adm_1',
			id,
			{ expectedDraftId: draft, from: null, until: null, handBackTo: null, whenReady: false },
			OWNER,
			T0,
		);
		const safe = await h.goLive.safeMode('adm_1', 'home', true, later(1));
		expect(safe).toMatchObject({ builderOn: false, safeMode: { by: 'adm_1', byName: 'Moulik' } });
		expect((await h.builder.shopLayout('home', 'en', later(2))).sections).toEqual([]);
		const off = await h.goLive.safeMode('adm_1', 'home', false, later(3));
		expect(off).toMatchObject({ builderOn: true, safeMode: null });
	});
});

describe('the nightly check (SG-12)', () => {
	it('runs live and scheduled layouts through the checks again and keeps the result for the bell', async () => {
		const h = harness();
		await h.filledSettings();
		const base = { from: null, until: null, handBackTo: null, whenReady: false };
		const { id, draft } = await h.layout('Everyday', [banner('/collections/sarees'), letter]);
		await h.goLive.goLive('adm_1', id, { ...base, expectedDraftId: draft }, OWNER, T0);
		expect(await h.goLive.nightlyCheck(later(1))).toBe(0);
		// The collection goes off the shop overnight.
		const goLive = h.goLive as unknown as { placements: { listLivePaths: () => Promise<string[]> } };
		goLive.placements.listLivePaths = async () => [];
		expect(await h.goLive.nightlyCheck(later(2))).toBe(1);
		expect((await h.goLive.alerts(STAFF)).nightly).toEqual({
			checkedAt: later(2).toISOString(),
			layouts: [{ layoutId: id, pageType: 'home', layoutName: 'Everyday', problems: 1 }],
		});
	});
});

describe('export, import and sales by schedule (SG-22, SG-23)', () => {
	it('exports the draft as a file and imports it as a new layout of the same page only', async () => {
		const h = harness();
		const { id } = await h.layout('Winter weddings', [letter]);
		const file = await h.goLive.export(id, T0);
		expect(file).toMatchObject({
			format: 'saha-textile.page-layout',
			version: 1,
			pageType: 'home',
			name: 'Winter weddings',
		});
		const imported = await h.goLive.import('adm_1', 'home', file, later(1));
		expect(imported.layout.id).not.toBe(id);
		expect(imported.draft?.sections).toEqual([letter]);
		await expect(
			h.goLive.import('adm_1', 'home', { ...file, pageType: 'about_us' }, later(2)),
		).rejects.toMatchObject({
			status: 400,
			response: { code: 'import_other_page' },
		});
	});

	it('totals paid orders for each stretch a layout showed, newest first', async () => {
		const h = harness();
		await h.filledSettings();
		const base = { from: null, until: null, handBackTo: null, whenReady: false };
		const today = await h.layout('Today’s home page', [letter]);
		await h.goLive.goLive('adm_1', today.id, { ...base, expectedDraftId: today.draft }, OWNER, T0);
		const puja = await h.layout('Puja', [row('new'), letter]);
		await h.goLive.goLive('adm_1', puja.id, { ...base, expectedDraftId: puja.draft }, OWNER, later(120));
		const sales = await h.goLive.sales('home', later(300));
		expect(sales.rows.map((r) => [r.layoutName, r.orders, r.totalINR, r.until])).toEqual([
			['Puja', 3, 7500, null],
			['Today’s home page', 2, 5000, later(120).toISOString()],
		]);
	});
});

describe('words over pictures at Go Live (SG-1)', () => {
	const worded = (assetId: string, ink = 'brand') =>
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
							heading: { en: 'Made for evenings', bn: 'সন্ধ্যার জন্য' },
							ink,
						},
					],
				},
			],
		});
	/** Nine spots, every pixel at this luminance. */
	const spots = (value: number) =>
		Array.from({ length: 9 }, () => {
			const hist = new Array<number>(32).fill(0);
			hist[Math.floor(value * 32)] = 1;
			return { hist };
		});
	const measured = (id: string, value: number) =>
		({ ...photo(id, 'ready'), versions: [{ id: 'ver_1', state: 'ready', wordSpots: spots(value) }] }) as MediaAsset;

	it('sends an unmeasured version to the worker and waits for it, never blocking as a fault', async () => {
		const h = harness();
		await h.filledSettings();
		const { id } = await h.layout('Words', [worded('med_ready')]);
		const view = await h.goLive.view(id, OWNER, T0);
		expect(view.problems).toEqual([]);
		expect(view.waitingPictures).toBe(1);
		expect(h.queue.enqueue).toHaveBeenCalledWith({ type: 'word-spots', assetId: 'med_ready', versionId: 'ver_1' });
	});

	it('holds Go Live when the words can’t be read, and offers only fixes that pass', async () => {
		const h = harness();
		await h.filledSettings();
		h.photos.set('med_pale', measured('med_pale', 0.55));
		const { id } = await h.layout('Pale', [worded('med_pale')]);
		const view = await h.goLive.view(id, OWNER, T0);
		const phone = view.problems.find((problem) => problem.kind === 'words_unreadable' && problem.band === 'phone');
		expect(phone).toMatchObject({ field: 'heading', needed: 4.5 });
		expect(phone?.fixes?.length).toBeGreaterThan(0);
		expect(phone?.fixes?.every((fix) => fix.ratio >= 4.5)).toBe(true);
		// Dark words on the same picture read everywhere.
		const { id: dark } = await h.layout('Dark', [worded('med_pale', 'ink')]);
		expect((await h.goLive.view(dark, OWNER, T0)).problems).toEqual([]);
	});
});

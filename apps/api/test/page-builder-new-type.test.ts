import { PageSection } from '@saha-textile/contracts';
import { registerPageType, pageTypeRules } from '@saha-textile/core-domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LanguageStore } from '../src/languages/language-store';
import { PageBuilderService } from '../src/page-builder/page-builder.service';
import { GO_LIVE_PERMISSION, PageGoLiveService } from '../src/page-builder/page-go-live.service';
import { PagePreviewService } from '../src/page-builder/page-preview.service';
import { memoryLayouts } from './page-builder-memory';

/**
 * Proof of generality (Page Builder PG-8): a second page type, registered only here, goes through the list, its
 * layouts, the builder's draft and checks, the preview, Go Live and the schedule with the same store, the same
 * services, the same routes and the same permission as Home. Nothing in this test is new code for the new type.
 */
const T0 = new Date('2026-11-17T10:00:00.000Z');
const PERMISSIONS = [GO_LIVE_PERMISSION, 'theme_option.index', 'theme_option.edit'];

const letter = PageSection.parse({ id: 'news', type: 'newsletter', title: { en: 'Join', bn: 'যোগ দিন' } });
const banner = PageSection.parse({ id: 'hero', type: 'banner_arrangement' });

function tokens() {
	const rows: Array<{
		hash: string;
		kind: string;
		layoutId: string;
		revisionId: string | null;
		expiresAt: string;
		used: boolean;
	}> = [];
	return {
		createCode: async (input: {
			codeHash: string;
			layoutId: string;
			revisionId?: string | null;
			expiresAt: string;
		}) =>
			void rows.push({
				hash: input.codeHash,
				kind: 'code',
				layoutId: input.layoutId,
				revisionId: input.revisionId ?? null,
				expiresAt: input.expiresAt,
				used: false,
			}),
		useCode: async (hash: string) => {
			const row = rows.find((r) => r.hash === hash && r.kind === 'code' && !r.used);
			if (!row) return null;
			row.used = true;
			return { layoutId: row.layoutId, revisionId: row.revisionId };
		},
		createSession: async (input: {
			tokenHash: string;
			layoutId: string;
			revisionId?: string | null;
			expiresAt: string;
		}) =>
			void rows.push({
				hash: input.tokenHash,
				kind: 'session',
				layoutId: input.layoutId,
				revisionId: input.revisionId ?? null,
				expiresAt: input.expiresAt,
				used: false,
			}),
		findSession: async (hash: string) => {
			const row = rows.find((r) => r.hash === hash && r.kind === 'session');
			return row ? { layoutId: row.layoutId, revisionId: row.revisionId } : null;
		},
	};
}

describe('a test-only page type through the whole flow (PG-8)', () => {
	let unregister: () => void = () => undefined;
	beforeAll(() => {
		unregister = registerPageType({
			key: 'pb_test',
			kind: 'item',
			slots: { main: ['newsletter', 'product_row'] },
			// An item page: its H1 is the item's own name, so no Page settings are needed.
			mainHeading: 'item_name',
			indexable: false,
			budget: { earlyPicturesPerBand: 1, firstLoadCodeKb: 10, surroundHtmlKb: 16, pageHtmlKb: 60 },
		});
	});
	afterAll(() => unregister());

	it('is registered by its rules alone, and only once', () => {
		expect(pageTypeRules('pb_test')?.kind).toBe('item');
		expect(() =>
			registerPageType(pageTypeRules('pb_test') as NonNullable<ReturnType<typeof pageTypeRules>>),
		).toThrow();
	});

	it('lists, builds, checks, previews, goes live and is drawn, with nothing made for it', async () => {
		const store = memoryLayouts();
		const settings = new Map<string, unknown>();
		const settingsRepo = {
			get: vi.fn(async (key: string) => settings.get(key) ?? null),
			set: vi.fn(async (key: string, value: unknown) => void settings.set(key, value)),
		};
		const languages = LanguageStore.fixed(['en', 'bn']);
		const builder = new PageBuilderService(
			store.repo,
			languages,
			{ findById: async () => ({ displayName: 'Moulik' }) } as never,
			{ findById: async () => null, findManyByIds: async () => [] } as never,
			{ getUrl: (key: string) => `https://cdn/${key}` } as never,
			settingsRepo as never,
			{ list: async () => [] } as never,
			{ append: vi.fn(async () => undefined) } as never,
		);
		const goLive = new PageGoLiveService(
			store.repo,
			{ list: async () => [] },
			builder,
			languages,
			settingsRepo as never,
			{ findBySlug: async () => null },
			{ findBySlug: async () => null },
			{ findByKey: async () => null },
			{ findActive: async () => null },
		);
		const preview = new PagePreviewService(tokens() as never, store.repo, builder);

		// The list: the same call that lists Home.
		expect((await builder.pages(T0)).map((row) => row.pageType)).toEqual(['home', 'pb_test']);

		// Its layouts and the builder: the same store and draft guard.
		const created = await builder.createLayout('adm_1', 'pb_test', {
			name: 'Test layout',
			start: 'blank',
			copyOf: null,
			template: null,
			bringPictures: true,
		});
		const first = await builder.saveDraft(
			'adm_1',
			created.layout.id,
			{ sections: [banner], expectedDraftId: null },
			T0,
		);
		// The type's own slot rules hold: a banner is not taken on this page.
		expect(first.problems).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'not_allowed' })]));
		expect(first.allowedSections).toEqual(['newsletter', 'product_row']);
		const draft = await builder.saveDraft(
			'adm_1',
			created.layout.id,
			{ sections: [letter], expectedDraftId: first.draft?.id ?? null },
			T0,
		);
		expect(draft.problems).toEqual([]);

		// The preview: one-time code, session, the draft drawn.
		const { code } = await preview.code('adm_1', created.layout.id, null, T0);
		const session = await preview.exchange(code, T0);
		expect(session.pageType).toBe('pb_test');
		expect((await preview.layout(session.token, 'en', T0)).sections.map((section) => section.type)).toEqual([
			'newsletter',
		]);

		// Go Live with the same permission and checks; no Page settings asked, its H1 is the item's name.
		const view = await goLive.view(created.layout.id, PERMISSIONS, T0);
		expect(view.problems).toEqual([]);
		const went = await goLive.goLive(
			'adm_1',
			created.layout.id,
			{ expectedDraftId: draft.draft?.id ?? '', from: null, until: null, handBackTo: null, whenReady: false },
			PERMISSIONS,
			T0,
		);
		expect(went).toMatchObject({ state: 'live', page: { pageType: 'pb_test', builderOn: true } });
		expect(settings.get('storefront.pageBuilder')).toBeUndefined();

		// The shop's call draws it, from the same schedule rules.
		const shop = await builder.shopLayout('pb_test', 'bn', new Date(T0.getTime() + 1_000));
		expect(shop.revisionId).toBe(draft.draft?.id);
		expect(shop.sections[0]).toMatchObject({ type: 'newsletter', title: 'যোগ দিন' });

		// Coming up and History work the same way.
		expect((await goLive.history(created.layout.id, T0)).revisions[0]).toMatchObject({ isLive: true });
	});

	it('answers 404 for a page type nobody registered', async () => {
		const store = memoryLayouts();
		const builder = new PageBuilderService(
			store.repo,
			LanguageStore.fixed(['en']),
			{ findById: async () => null } as never,
			{ findById: async () => null, findManyByIds: async () => [] } as never,
			{ getUrl: (key: string) => key } as never,
			{ get: async () => null } as never,
			{ list: async () => [] } as never,
		);
		await expect(builder.page('about_us')).rejects.toMatchObject({ status: 404 });
		await expect(builder.shopLayout('about_us', 'en')).rejects.toMatchObject({ status: 404 });
	});
});

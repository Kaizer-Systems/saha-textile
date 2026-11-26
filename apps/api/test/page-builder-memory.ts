import type { BuilderPage, LayoutRevision, PageLayout, PageTypeKey } from '@saha-textile/contracts';
import type { PageLayoutRepository } from '@saha-textile/core-domain';

export const NO_SETTINGS = { title: {}, description: {}, heading: {}, headingShown: false, shareImage: null };

/** An in-memory stand-in for the Page Builder store, with the same draft guard the Mongo adapter has. */
export function memoryLayouts() {
	const pages = new Map<string, BuilderPage>();
	const layouts = new Map<string, PageLayout & { count: number }>();
	const revisions = new Map<string, LayoutRevision>();
	const locks = new Map<string, { holder: string; since: string; heartbeatAt: string }>();
	const pageOf = (pageType: PageTypeKey, target: string, at: string): BuilderPage =>
		pages.get(`${pageType}:${target}`) ?? {
			pageType,
			target,
			schedule: [],
			settings: NO_SETTINGS,
			safeMode: null,
			pending: [],
			updatedAt: at,
		};
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
		goLive: async ({ pageType, target, entry, also, at }) => {
			const page = pageOf(pageType, target, at);
			pages.set(`${pageType}:${target}`, {
				...page,
				schedule: [...page.schedule, entry, ...(also ?? [])],
				updatedAt: at,
			});
			const revision = revisions.get(entry.revisionId);
			if (revision && !revision.wentLiveAt) revisions.set(revision.id, { ...revision, wentLiveAt: at });
			const layout = layouts.get(entry.layoutId);
			if (layout) layouts.set(layout.id, { ...layout, lastLiveRevisionId: entry.revisionId, updatedAt: at });
		},
		setSchedule: async (pageType, target, schedule, at) => {
			pages.set(`${pageType}:${target}`, { ...pageOf(pageType, target, at), schedule, updatedAt: at });
		},
		saveSettings: async (pageType, target, settings, at) => {
			pages.set(`${pageType}:${target}`, { ...pageOf(pageType, target, at), settings, updatedAt: at });
		},
		setSafeMode: async (pageType, target, safeMode, at) => {
			pages.set(`${pageType}:${target}`, { ...pageOf(pageType, target, at), safeMode, updatedAt: at });
		},
		setPending: async (pageType, target, pending, at) => {
			pages.set(`${pageType}:${target}`, { ...pageOf(pageType, target, at), pending, updatedAt: at });
		},
		setReviewRequest: async (layoutId, reviewRequest) => {
			const layout = layouts.get(layoutId);
			if (layout) layouts.set(layoutId, { ...layout, reviewRequest });
		},
		reviewRequests: async () => [...layouts.values()].filter((layout) => layout.reviewRequest),
		lock: async ({ layoutId, by, at, staleBefore }) => {
			if (!layouts.has(layoutId)) return null;
			const held = locks.get(layoutId);
			if (held && held.holder !== by && held.heartbeatAt >= staleBefore) return held;
			const next = { holder: by, since: held?.holder === by ? held.since : at, heartbeatAt: at };
			locks.set(layoutId, next);
			return next;
		},
		unlock: async (layoutId, by) => {
			if (locks.get(layoutId)?.holder === by) locks.delete(layoutId);
		},
		currentLock: async (layoutId, staleBefore) => {
			const held = locks.get(layoutId);
			return held && held.heartbeatAt >= staleBefore ? held : null;
		},
		prune: async () => 0,
	};
	return { repo, pages, layouts, revisions, locks };
}

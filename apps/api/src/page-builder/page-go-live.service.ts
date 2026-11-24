import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import {
	EMPTY_PAGE_SETTINGS,
	type AdminBuilderPage,
	type AdminLayoutView,
	type BringBackRequest,
	type CancelSwitchRequest,
	type GoLiveRequest,
	type GoLiveResponse,
	type GoLiveView,
	type LayoutExport,
	type LayoutHistoryResponse,
	LAYOUT_EXPORT_FORMAT,
	type PageSalesResponse,
	type PageBuilderAlerts,
	type PageLayout,
	type PageSection,
	type PageTypeKey,
	type PendingGoLive,
	type ScheduleEntry,
} from '@saha-textile/contracts';
import {
	mayGoLivePage,
	SUPER_ADMIN_ROLE_KEY,
	type AdminUserRoleAssignmentRepository,
	type BlogPostRepository,
	type CategoryPlacementRepository,
	type LayoutProblem,
	type OrderRepository,
	type PageLayoutRepository,
	type ProductRepository,
	type RoleRepository,
	type SavedBlockRepository,
	type SiteSettingsRepository,
	budgetLines,
	budgetProblems,
	designNotes,
	layoutChanges,
	layoutLinks,
	layoutSummary,
	linkProblems,
	linkedBlockIds,
	liveEntry,
	livePeriods,
	pageSettingsGaps,
	pageSettingsProblems,
	pageTypeRules,
	previousLiveEntry,
	registeredPageTypes,
	scheduleWithGoLive,
	scheduleWithout,
	shopPath,
	shopPathTarget,
	withLinkedBlocks,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY,
	BLOG_POST_REPOSITORY,
	CATEGORY_PLACEMENT_REPOSITORY,
	ORDER_REPOSITORY,
	PAGE_LAYOUT_REPOSITORY,
	PRODUCT_REPOSITORY,
	ROLE_REPOSITORY,
	SAVED_BLOCK_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
} from '../infra/tokens';
import { LanguageStore } from '../languages/language-store';
import { PageBuilderService, drawsBuilder } from './page-builder.service';

const WHOLE_PAGE = 'page';

/** The permission that changes what shoppers see (Q10 A): the owner and super admins. */
export const GO_LIVE_PERMISSION = 'page_builder.go_live';

const same = (a: readonly PageSection[], b: readonly PageSection[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Problems that only wait for time: a picture still being made (E5), or its word spots being measured (SG-1). */
const waits = (problem: LayoutProblem): boolean =>
	problem.kind === 'picture_not_ready' || problem.kind === 'words_unmeasured';

/**
 * Go Live (Page Builder build step 7): the checks with what will change and the speed budget (E1, E2, P6, SG-9,
 * SG-13, SG-16), going live now, at a time or by itself once pictures are ready (E5), History and Bring back (E3,
 * Q12), Put back and safe mode (SG-15), cancelling a switch, Ask for review (SG-18) and the bell's lines (SG-12).
 * Every page type goes through the same calls.
 */
@Injectable()
export class PageGoLiveService {
	constructor(
		@Inject(PAGE_LAYOUT_REPOSITORY) private readonly layouts: PageLayoutRepository,
		@Inject(SAVED_BLOCK_REPOSITORY) private readonly blocks: Pick<SavedBlockRepository, 'list'>,
		private readonly builder: PageBuilderService,
		private readonly languages: LanguageStore,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Inject(PRODUCT_REPOSITORY) private readonly products: Pick<ProductRepository, 'findBySlug'>,
		@Inject(BLOG_POST_REPOSITORY) private readonly posts: Pick<BlogPostRepository, 'findBySlug'>,
		@Inject(ROLE_REPOSITORY) private readonly roles: Pick<RoleRepository, 'findByKey'>,
		@Inject(ADMIN_USER_ROLE_ASSIGNMENT_REPOSITORY)
		private readonly assignments: Pick<AdminUserRoleAssignmentRepository, 'findActive'>,
		@Optional()
		@Inject(CATEGORY_PLACEMENT_REPOSITORY)
		private readonly placements: Pick<CategoryPlacementRepository, 'listLivePaths'> | null = null,
		@Optional()
		@Inject(ORDER_REPOSITORY)
		private readonly orders: Pick<OrderRepository, 'paidTotalsBetween'> | null = null,
	) {}

	// ── Checks ──────────────────────────────────────────────────────────────────────────────────────

	/** The sections that would go live: the draft with every linked block's current content (SG-5). */
	private async goingLive(sections: readonly PageSection[]): Promise<PageSection[]> {
		const ids = linkedBlockIds(sections);
		if (!ids.length) return [...sections];
		const blocks = new Map((await this.blocks.list()).map((block) => [block.id, block]));
		return withLinkedBlocks(sections, blocks);
	}

	/** Which of these shop paths open a live page now (SG-13). */
	private async livePaths(paths: readonly string[], now: Date): Promise<Set<string>> {
		const live = new Set<string>();
		let collections: Set<string> | null = null;
		for (const path of new Set(paths)) {
			const target = shopPathTarget(path);
			if (target.kind === 'fixed') live.add(path);
			else if (target.kind === 'product') {
				if (await this.products.findBySlug(target.slug, 'public').catch(() => null)) live.add(path);
			} else if (target.kind === 'collection') {
				collections ??= new Set(await (this.placements?.listLivePaths() ?? Promise.resolve([])));
				if (collections.has(target.path)) live.add(path);
			} else if (target.kind === 'blog_post') {
				const post = await this.posts.findBySlug(target.slug).catch(() => null);
				if (post?.status === 'live' && post.publishedAt && Date.parse(post.publishedAt) <= now.getTime()) {
					live.add(path);
				}
			}
		}
		return live;
	}

	/** Everything that holds a revision's Go Live: the builder's list, links, the main heading and the budget. */
	async problems(pageType: PageTypeKey, sections: readonly PageSection[], now: Date): Promise<LayoutProblem[]> {
		const rules = pageTypeRules(pageType);
		if (!rules) return [];
		const locales = this.languages.shop();
		const links = layoutLinks(sections);
		const paths = links.flatMap((link) => {
			const path = shopPath(link.href, locales);
			return path === null ? [] : [path];
		});
		const live = await this.livePaths(paths, now);
		const page = await this.layouts.page(pageType, WHOLE_PAGE);
		const heading =
			rules.mainHeading === 'page_settings'
				? pageSettingsProblems(pageSettingsGaps(page?.settings ?? EMPTY_PAGE_SETTINGS, locales))
				: [];
		return [
			...(await this.builder.problemsFor(pageType, sections)),
			...linkProblems(links, locales, (path) => live.has(path)),
			...heading,
			...budgetProblems(budgetLines(sections, rules)),
		];
	}

	/** SG-19: `page_builder.go_live` on every page, or this page type's own Go Live code. */
	private async canGoLive(permissions: readonly string[], pageType: string): Promise<boolean> {
		return mayGoLivePage(permissions, pageType);
	}

	/** Refuses a switch, a cancelled switch or a put-back on a page this admin may not go live on (SG-19). */
	async assertMayGoLive(permissions: readonly string[], type: string): Promise<void> {
		const pageType = this.requireType(type);
		if (!(await this.canGoLive(permissions, pageType)))
			throw new ForbiddenException('You may not change what shoppers see on this page');
	}

	/** E1, E2, P6: what Go Live would do, and what holds it. */
	async view(id: string, permissions: readonly string[], now = new Date()): Promise<GoLiveView> {
		const layout = await this.requireLayout(id);
		const rules = pageTypeRules(layout.pageType);
		if (!rules) throw new NotFoundException('No such page');
		const draft = layout.draftRevisionId ? await this.layouts.revision(layout.draftRevisionId) : null;
		const sections = await this.goingLive(draft?.sections ?? []);
		const [page, siblings, problems] = await Promise.all([
			this.layouts.page(layout.pageType, WHOLE_PAGE),
			this.layouts.layouts(layout.pageType, WHOLE_PAGE),
			this.problems(layout.pageType, sections, now),
		]);
		const schedule = page?.schedule ?? [];
		const live = (await this.builderOn(layout.pageType, page, now)) ? liveEntry(schedule, now) : null;
		const liveRevision = live ? await this.layouts.revision(live.revisionId) : null;
		const names = new Map(siblings.map((sibling) => [sibling.id, sibling.name]));
		return {
			layoutId: layout.id,
			layoutName: layout.name,
			draftRevisionId: draft?.id ?? null,
			problems: problems.filter((problem) => !waits(problem)),
			waitingPictures: problems.filter(waits).length,
			liveLayoutName: live ? (names.get(live.layoutId) ?? null) : null,
			changes: layoutChanges(liveRevision?.sections ?? null, sections),
			budget: budgetLines(sections, rules),
			summary: layoutSummary(sections),
			notes: designNotes(sections),
			linkedBlocks: await this.linkedBlocks(sections, siblings),
			handBackTo: siblings
				.filter((sibling) => sibling.id !== layout.id && sibling.lastLiveRevisionId)
				.map((sibling) => ({ layoutId: sibling.id, name: sibling.name })),
			naturalHandBack: live && live.layoutId !== layout.id ? live.layoutId : null,
			canGoLive: await this.canGoLive(permissions, layout.pageType),
		};
	}

	/** Linked blocks the draft uses, and the other layouts whose drafts link them too (C43). */
	private async linkedBlocks(sections: readonly PageSection[], siblings: readonly PageLayout[]) {
		const ids = linkedBlockIds(sections);
		if (!ids.length) return [];
		const blocks = new Map((await this.blocks.list()).map((block) => [block.id, block]));
		const drafts = await Promise.all(
			siblings.map(async (sibling) => ({
				name: sibling.name,
				ids: linkedBlockIds((await this.layouts.revision(sibling.draftRevisionId ?? ''))?.sections ?? []),
			})),
		);
		return ids.flatMap((blockId) => {
			const block = blocks.get(blockId);
			return block
				? [
						{
							blockId,
							name: block.name,
							layouts: drafts.filter((draft) => draft.ids.includes(blockId)).map((draft) => draft.name),
						},
					]
				: [];
		});
	}

	private async builderOn(
		pageType: PageTypeKey,
		page: { safeMode: unknown; schedule: ScheduleEntry[] } | null,
		now: Date,
	): Promise<boolean> {
		const switches = await this.settings.get('storefront.pageBuilder');
		return drawsBuilder(switches?.[pageType], liveEntry(page?.schedule ?? [], now), page?.safeMode ?? null);
	}

	// ── Go Live ─────────────────────────────────────────────────────────────────────────────────────

	/**
	 * Go Live now, at a time, or by itself once its pictures are ready (E5). The draft checked is the draft that goes:
	 * a newer one is refused (409). Linked blocks are drawn into a revision of their own first, so what went live is
	 * kept exactly. The schedule entry, the revision's mark and the layout's pointer change in one transaction.
	 */
	async goLive(
		actor: string | null,
		id: string,
		request: GoLiveRequest,
		permissions: readonly string[],
		now = new Date(),
	): Promise<GoLiveResponse> {
		const layout = await this.requireLayout(id);
		if (!(await this.canGoLive(permissions, layout.pageType)))
			throw new ForbiddenException('Only the owner and super admins go live');
		if (!layout.draftRevisionId || layout.draftRevisionId !== request.expectedDraftId) {
			throw new ConflictException({
				message: 'This layout was saved again since you checked it',
				code: 'layout_moved_on',
				draftRevisionId: layout.draftRevisionId,
			});
		}
		const draft = await this.layouts.revision(layout.draftRevisionId);
		if (!draft) throw new NotFoundException('No such draft');
		const sections = await this.goingLive(draft.sections);
		const problems = await this.problems(layout.pageType, sections, now);
		const blocking = problems.filter((problem) => !(request.whenReady && waits(problem)));
		if (blocking.length) {
			throw new BadRequestException({ message: 'Go Live waits', code: 'go_live_refused', problems: blocking });
		}
		// Linked blocks drawn in: that content is a revision of its own, and it is what goes live.
		let revisionId = draft.id;
		if (!same(sections, draft.sections)) {
			const saved = await this.layouts.saveDraft({
				layoutId: id,
				sections,
				expectedDraftId: draft.id,
				by: actor,
				at: now.toISOString(),
			});
			if (!saved) throw new ConflictException({ message: 'Saved again meanwhile', code: 'layout_moved_on' });
			revisionId = saved.id;
		}
		const entry: ScheduleEntry = {
			revisionId,
			layoutId: id,
			from: request.from ?? now.toISOString(),
			until: request.until,
			by: actor,
		};
		const handBack = await this.handBack(layout, request);
		const page = await this.layouts.page(layout.pageType, WHOLE_PAGE);
		const planned = scheduleWithGoLive({ schedule: page?.schedule ?? [], entry, handBack, now });
		if (typeof planned === 'string') {
			throw new BadRequestException({ message: 'That time cannot be used', code: planned });
		}
		if (problems.some(waits)) {
			const waiting: PendingGoLive = { entry, handBack, requestedAt: now.toISOString() };
			await this.layouts.setPending(
				layout.pageType,
				WHOLE_PAGE,
				[...(page?.pending ?? []), waiting],
				now.toISOString(),
			);
			await this.builder.record(actor, 'page_layout.go_live_waiting', id, {
				from: entry.from,
				until: entry.until,
			});
			return { state: 'waiting', page: await this.builder.page(layout.pageType, now) };
		}
		await this.commit(layout.pageType, entry, handBack, now);
		await this.layouts.setReviewRequest(id, null);
		await this.builder.record(actor, 'page_layout.go_live', id, {
			revisionId,
			from: entry.from,
			until: entry.until,
			handBackTo: handBack?.layoutId ?? null,
		});
		const state = Date.parse(entry.from) <= now.getTime() ? 'live' : 'scheduled';
		return { state, page: await this.builder.page(layout.pageType, now) };
	}

	/** The schedule gains the switch (and its hand-back) in one transaction. */
	private async commit(
		pageType: PageTypeKey,
		entry: ScheduleEntry,
		handBack: { revisionId: string; layoutId: string } | null,
		now: Date,
	): Promise<void> {
		const also: ScheduleEntry[] =
			handBack && entry.until
				? [
						{
							revisionId: handBack.revisionId,
							layoutId: handBack.layoutId,
							from: entry.until,
							until: null,
							by: entry.by,
						},
					]
				: [];
		// The page is drawn by the builder from the moment this switch starts (drawsBuilder): now, or at its time.
		await this.layouts.goLive({ pageType, target: WHOLE_PAGE, entry, also, at: now.toISOString() });
		// FX-8: the shop is asked for the page just after each switch, and now when this one shows at once.
		await this.builder.warmSwitches(pageType, now, Date.parse(entry.from) <= now.getTime());
	}

	/** E2 "then back to": the chosen layout's last live revision, from the end of this switch. */
	private async handBack(
		layout: PageLayout,
		request: GoLiveRequest,
	): Promise<{ revisionId: string; layoutId: string } | null> {
		if (!request.until || !request.handBackTo) return null;
		const other = await this.layouts.layout(request.handBackTo);
		if (!other || other.pageType !== layout.pageType || !other.lastLiveRevisionId || other.id === layout.id) {
			throw new BadRequestException({ message: 'That layout cannot take over', code: 'hand_back_refused' });
		}
		return { revisionId: other.lastLiveRevisionId, layoutId: other.id };
	}

	/**
	 * E5: Go Lives waiting for pictures. Each is checked again; it joins the schedule once nothing holds it (a start
	 * already past becomes now), stays while pictures are still being made, and is dropped (and audited) if something
	 * else now holds it, such as a picture that failed. Run by the worker every minute; answers how many went.
	 */
	async settleWaiting(now = new Date()): Promise<number> {
		let went = 0;
		for (const rules of registeredPageTypes()) {
			const pageType = rules.key as PageTypeKey;
			const page = await this.layouts.page(pageType, WHOLE_PAGE);
			if (!page?.pending.length) continue;
			const keep: PendingGoLive[] = [];
			for (const row of page.pending) {
				const revision = await this.layouts.revision(row.entry.revisionId);
				const problems = revision ? await this.problems(pageType, revision.sections, now) : [];
				if (!revision || problems.some((problem) => !waits(problem))) {
					await this.builder.record(null, 'page_layout.go_live_dropped', row.entry.layoutId, {
						problems: problems.length,
					});
					continue;
				}
				if (problems.length) {
					keep.push(row);
					continue;
				}
				const from = Date.parse(row.entry.from) < now.getTime() ? now.toISOString() : row.entry.from;
				if (row.entry.until && Date.parse(row.entry.until) <= Date.parse(from)) {
					await this.builder.record(null, 'page_layout.go_live_dropped', row.entry.layoutId, { ended: true });
					continue;
				}
				await this.commit(pageType, { ...row.entry, from }, row.handBack, now);
				await this.layouts.setReviewRequest(row.entry.layoutId, null);
				await this.builder.record(row.entry.by, 'page_layout.go_live', row.entry.layoutId, {
					revisionId: row.entry.revisionId,
					from,
					until: row.entry.until,
					byItself: true,
				});
				went += 1;
			}
			if (keep.length !== page.pending.length) {
				await this.layouts.setPending(pageType, WHOLE_PAGE, keep, now.toISOString());
			}
		}
		return went;
	}

	/** Takes a waiting Go Live off (E5 "Wait" after all). */
	async cancelWaiting(
		actor: string | null,
		type: string,
		layoutId: string,
		now = new Date(),
	): Promise<AdminBuilderPage> {
		const pageType = this.requireType(type);
		const page = await this.layouts.page(pageType, WHOLE_PAGE);
		const keep = (page?.pending ?? []).filter((row) => row.entry.layoutId !== layoutId);
		if (keep.length === (page?.pending.length ?? 0)) throw new NotFoundException('Nothing waiting');
		await this.layouts.setPending(pageType, WHOLE_PAGE, keep, now.toISOString());
		await this.builder.record(actor, 'page_layout.go_live_cancelled', layoutId, {});
		return this.builder.page(pageType, now);
	}

	// ── The schedule: cancel, put back, safe mode ──────────────────────────────────────────────────

	/** A1: takes a switch still to come off the schedule. */
	async cancelSwitch(
		actor: string | null,
		type: string,
		request: CancelSwitchRequest,
		now = new Date(),
	): Promise<AdminBuilderPage> {
		const pageType = this.requireType(type);
		const page = await this.layouts.page(pageType, WHOLE_PAGE);
		const next = scheduleWithout(page?.schedule ?? [], request, now);
		if (!next) throw new NotFoundException('No such switch still to come');
		await this.layouts.setSchedule(pageType, WHOLE_PAGE, next, now.toISOString());
		await this.builder.record(actor, 'page_layout.cancel_switch', request.revisionId, { from: request.from });
		return this.builder.page(pageType, now);
	}

	/** SG-15: one click brings back the layout that showed before the one showing now. */
	async putBack(actor: string | null, type: string, now = new Date()): Promise<AdminBuilderPage> {
		const pageType = this.requireType(type);
		const page = await this.layouts.page(pageType, WHOLE_PAGE);
		const schedule = page?.schedule ?? [];
		const previous = previousLiveEntry(schedule, liveEntry(schedule, now));
		if (!previous) throw new NotFoundException('Nothing to put back');
		const entry: ScheduleEntry = {
			revisionId: previous.revisionId,
			layoutId: previous.layoutId,
			from: now.toISOString(),
			until: null,
			by: actor,
		};
		await this.layouts.goLive({ pageType, target: WHOLE_PAGE, entry, at: now.toISOString() });
		await this.builder.warmSwitches(pageType, now, true);
		await this.builder.record(actor, 'page_layout.put_back', previous.layoutId, {
			revisionId: previous.revisionId,
		});
		return this.builder.page(pageType, now);
	}

	/** A super admin holds the system Administrator role. */
	private async isSuperAdmin(userId: string | null): Promise<boolean> {
		if (!userId) return false;
		const role = await this.roles.findByKey(SUPER_ADMIN_ROLE_KEY);
		return !!role && !!(await this.assignments.findActive(userId, role.id));
	}

	/** SG-15: super admins put a page on the shop's fixed code (and take it off again); Go Live never undoes it. */
	async safeMode(actor: string | null, type: string, on: boolean, now = new Date()): Promise<AdminBuilderPage> {
		const pageType = this.requireType(type);
		if (!(await this.isSuperAdmin(actor))) throw new ForbiddenException('Only super admins use safe mode');
		await this.layouts.setSafeMode(
			pageType,
			WHOLE_PAGE,
			on ? { by: actor, at: now.toISOString() } : null,
			now.toISOString(),
		);
		await this.builder.record(actor, on ? 'page_builder.safe_mode_on' : 'page_builder.safe_mode_off', pageType, {});
		return this.builder.page(pageType, now);
	}

	// ── History (E3, Q12) ───────────────────────────────────────────────────────────────────────────

	async history(id: string, now = new Date()): Promise<LayoutHistoryResponse> {
		const layout = await this.requireLayout(id);
		const page = await this.layouts.page(layout.pageType, WHOLE_PAGE);
		const showing = (await this.builderOn(layout.pageType, page, now))
			? liveEntry(page?.schedule ?? [], now)
			: null;
		const revisions = await this.layouts.revisions(id, 60);
		return {
			revisions: await Promise.all(
				revisions.map(async (revision) => ({
					id: revision.id,
					number: revision.number,
					createdAt: revision.createdAt,
					createdByName: await this.builder.adminName(revision.createdBy),
					wentLiveAt: revision.wentLiveAt,
					sections: revision.sections.filter((section) => !section.hidden).length,
					isDraft: revision.id === layout.draftRevisionId,
					isLive: showing?.revisionId === revision.id,
				})),
			),
		};
	}

	/** E3 "Bring back": a saved revision's sections become the draft (a new revision; nothing is overwritten). */
	async bringBack(
		actor: string | null,
		id: string,
		request: BringBackRequest,
		now = new Date(),
	): Promise<AdminLayoutView> {
		const revision = await this.layouts.revision(request.revisionId);
		if (!revision || revision.layoutId !== id) throw new NotFoundException('No such revision');
		const view = await this.builder.saveDraft(
			actor,
			id,
			{ sections: revision.sections, expectedDraftId: request.expectedDraftId },
			now,
		);
		await this.builder.record(actor, 'page_layout.bring_back', id, { from: revision.number });
		return view;
	}

	// ── Export and import (SG-22), sales by schedule (SG-23) ───────────────────────────────────────────

	/** The draft (or, without one, the last live revision) as a file another environment can import. */
	async export(id: string, now = new Date()): Promise<LayoutExport> {
		const layout = await this.requireLayout(id);
		const revision = await this.layouts.revision(layout.draftRevisionId ?? layout.lastLiveRevisionId ?? '');
		return {
			format: LAYOUT_EXPORT_FORMAT,
			version: 1,
			pageType: layout.pageType,
			name: layout.name,
			sections: revision?.sections ?? [],
			exportedAt: now.toISOString(),
		};
	}

	/**
	 * A layout from another environment becomes a new layout of this page with that draft. Its sections passed the
	 * same schema on the way in; a picture this environment lacks shows in its Go Live checks.
	 */
	async import(actor: string | null, type: string, file: LayoutExport, now = new Date()): Promise<AdminLayoutView> {
		const pageType = this.requireType(type);
		if (file.pageType !== pageType) {
			throw new BadRequestException({ message: 'That file is for another page', code: 'import_other_page' });
		}
		const created = await this.builder.createLayout(
			actor,
			pageType,
			{ name: file.name, start: 'blank', copyOf: null, template: null, bringPictures: false },
			now,
		);
		const view = await this.builder.saveDraft(
			actor,
			created.layout.id,
			{ sections: file.sections, expectedDraftId: null },
			now,
		);
		await this.builder.record(actor, 'page_layout.import', created.layout.id, {
			sections: file.sections.length,
			exportedAt: file.exportedAt,
		});
		return view;
	}

	/** SG-23: paid orders while each layout showed, from our own orders; no tracking on the shop. */
	async sales(type: string, now = new Date()): Promise<PageSalesResponse> {
		const pageType = this.requireType(type);
		const [page, layouts] = await Promise.all([
			this.layouts.page(pageType, WHOLE_PAGE),
			this.layouts.layouts(pageType, WHOLE_PAGE),
		]);
		const names = new Map(layouts.map((layout) => [layout.id, layout.name]));
		const periods = livePeriods(page?.schedule ?? [], now);
		return {
			rows: await Promise.all(
				periods.map(async (period) => {
					const totals = this.orders
						? await this.orders.paidTotalsBetween(period.from, period.until ?? now.toISOString())
						: { orders: 0, totalINR: 0 };
					return {
						layoutId: period.entry.layoutId,
						layoutName: names.get(period.entry.layoutId) ?? period.entry.layoutId,
						from: period.from,
						until: period.until,
						...totals,
					};
				}),
			),
		};
	}

	// ── Ask for review (SG-18) and the bell (SG-12) ─────────────────────────────────────────────────

	async askReview(actor: string | null, id: string, note: string, now = new Date()): Promise<void> {
		await this.requireLayout(id);
		await this.layouts.setReviewRequest(id, { by: actor, at: now.toISOString(), note });
		await this.builder.record(actor, 'page_layout.ask_review', id, { note: note.length > 0 });
	}

	/** A reviewer clears a request without going live (the draft needs more work). */
	async closeReview(actor: string | null, id: string, permissions: readonly string[]): Promise<void> {
		const layout = await this.requireLayout(id);
		if (!(await this.canGoLive(permissions, layout.pageType)))
			throw new ForbiddenException('Only reviewers close a review');
		await this.layouts.setReviewRequest(id, null);
		await this.builder.record(actor, 'page_layout.review_closed', id, {});
	}

	async alerts(permissions: readonly string[]): Promise<PageBuilderAlerts> {
		// Each reviewer sees the requests on the pages they may go live on (SG-19).
		const requests = (await this.layouts.reviewRequests()).filter((layout) =>
			mayGoLivePage(permissions, layout.pageType),
		);
		const nightly = await this.settings.get('page_builder_nightly_check');
		return {
			reviews: await Promise.all(
				requests.map(async (layout) => ({
					layoutId: layout.id,
					pageType: layout.pageType,
					layoutName: layout.name,
					byName: await this.builder.adminName(layout.reviewRequest?.by ?? null),
					at: layout.reviewRequest?.at ?? layout.updatedAt,
					note: layout.reviewRequest?.note ?? '',
				})),
			),
			nightly: nightly
				? {
						checkedAt: nightly.checkedAt,
						layouts: nightly.layouts
							.filter((row) => row.problems > 0)
							.map((row) => ({ ...row, pageType: row.pageType as PageTypeKey })),
					}
				: null,
		};
	}

	/**
	 * SG-12: every night, each live and scheduled revision runs through the Go Live checks again (a link whose page
	 * went off the shop, a picture gone, a language added). The result is kept for the bell.
	 */
	async nightlyCheck(now = new Date()): Promise<number> {
		const rows: Array<{ layoutId: string; pageType: string; layoutName: string; problems: number }> = [];
		for (const rules of registeredPageTypes()) {
			const pageType = rules.key as PageTypeKey;
			const page = await this.layouts.page(pageType, WHOLE_PAGE);
			const schedule = page?.schedule ?? [];
			const live = liveEntry(schedule, now);
			const wanted = schedule.filter((entry) => entry === live || Date.parse(entry.from) > now.getTime());
			const seen = new Set<string>();
			for (const entry of wanted) {
				if (seen.has(entry.revisionId)) continue;
				seen.add(entry.revisionId);
				const [revision, layout] = await Promise.all([
					this.layouts.revision(entry.revisionId),
					this.layouts.layout(entry.layoutId),
				]);
				const problems = revision ? await this.problems(pageType, revision.sections, now) : [];
				rows.push({
					layoutId: entry.layoutId,
					pageType,
					layoutName: layout?.name ?? entry.layoutId,
					// Measurements still on their way are not something to fix.
					problems: revision ? problems.filter((problem) => !waits(problem)).length : 1,
				});
			}
		}
		await this.settings.set('page_builder_nightly_check', { checkedAt: now.toISOString(), layouts: rows });
		return rows.filter((row) => row.problems > 0).length;
	}

	private requireType(type: string): PageTypeKey {
		if (!pageTypeRules(type)) throw new NotFoundException('No such page');
		return type as PageTypeKey;
	}

	private async requireLayout(id: string): Promise<PageLayout> {
		const layout = id ? await this.layouts.layout(id) : null;
		if (!layout) throw new NotFoundException('No such layout');
		return layout;
	}
}

import { randomUUID } from 'node:crypto';

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import type {
	AdminBuilderPage,
	AdminBuilderPageRow,
	AdminLayoutRow,
	AdminLayoutView,
	AuditLog,
	ComingUpResponse,
	LayoutLock,
	LayoutLockResponse,
	CreateLayoutRequest,
	MediaAsset,
	PageLayout,
	PageSection,
	PageSettings,
	PageTypeKey,
	RenameLayoutRequest,
	SaveLayoutDraft,
	StorefrontPageLayout,
	WordsMap,
	WordsMapBand,
	WordsMapQuery,
} from '@saha-textile/contracts';
import {
	WARM_AFTER_MS,
	switchesWithin,
	mayDraftPage,
	type AdminUserRepository,
	type AuditLogRepository,
	type MediaAssetRepository,
	type HeldLock,
	type PageLayoutRepository,
	type PictureFacts,
	comingUp,
	pageSettingsGaps,
	pageSettingsToSave,
	shopPageSettings,
	layoutProblems,
	layoutStatus,
	wordsMap,
	wordsProblems,
	type MediaJobQueuePort,
	previousLiveEntry,
	type LayoutProblem,
	nextContentChangeAt,
	liveEntry,
	nextSwitchAt,
	pageTypeRules,
	registeredPageTypes,
	HOME_TEMPLATES,
	isHomeTemplate,
	templateSections,
	type ContentBlockRepository,
	resolveImage,
	shopSections,
	type SiteSettingsRepository,
	type StoragePort,
} from '@saha-textile/core-domain';

import {
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	CONTENT_BLOCK_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	MEDIA_JOB_QUEUE,
	PAGE_LAYOUT_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { LanguageStore } from '../languages/language-store';

const WHOLE_PAGE = 'page';

/**
 * Whether the shop draws a page from its layouts: not in safe mode (SG-15), and either switched on by hand
 * (`storefront.pageBuilder`) or showing a switch someone made with Go Live or Put back. The release-time switch of
 * "Today's home page" (made by no one) leaves the fixed page until then, and a Go Live scheduled for later changes
 * nothing before it starts.
 */
export function drawsBuilder(
	switchedOn: boolean | undefined,
	live: { by: string | null } | null,
	safeMode: unknown,
): boolean {
	if (safeMode) return false;
	return !!switchedOn || (live !== null && live.by !== null);
}

/** The shop's theme colour when the Brand Kit has none (`scss/theme-color.css`). */
const DEFAULT_BRAND_COLOUR = '#417394';

/** A lock with no heartbeat for this long is free (FX-11: a closed laptop frees it within 2 minutes). */
const LOCK_MS = 120_000;

const NO_SETTINGS: PageSettings = { title: {}, description: {}, heading: {}, headingShown: false, shareImage: null };

/** A photo version's facts for the Go Live checks: ready to show, and its shape from the files it made. */
export function pictureFacts(asset: MediaAsset | null, versionId: string | null): PictureFacts | null {
	if (!asset || asset.deletedAt) return null;
	const version = versionId ? (asset.versions ?? []).find((candidate) => candidate.id === versionId) : null;
	if (versionId && !version) return null;
	const ready = version ? version.state === 'ready' : asset.processing.state === 'ready';
	const wordSpots = version ? (version.wordSpots ?? null) : false;
	const files = asset.derivatives.filter((file) => (versionId ? file.versionId === versionId : true));
	const widest = [...files].sort((a, b) => b.width - a.width)[0];
	const ratio = widest
		? widest.width / widest.height
		: asset.width && asset.height
			? asset.width / asset.height
			: null;
	return { ready, ratio, wordSpots };
}

/**
 * Page Builder, admin side (brief PG-1, PG-2, B): the list of pages, one page's schedule and layouts, a layout open
 * in the builder with what holds its Go Live, and draft saves that never land over a newer revision. Every page
 * type goes through the same calls; nothing here is about Home.
 */
@Injectable()
export class PageBuilderService {
	constructor(
		@Inject(PAGE_LAYOUT_REPOSITORY) private readonly layouts: PageLayoutRepository,
		private readonly languages: LanguageStore,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		@Inject(MEDIA_ASSET_REPOSITORY)
		private readonly assets: Pick<MediaAssetRepository, 'findById' | 'findManyByIds'>,
		@Inject(STORAGE_PORT) private readonly storage: Pick<StoragePort, 'getUrl'>,
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: Pick<SiteSettingsRepository, 'get'>,
		@Inject(CONTENT_BLOCK_REPOSITORY) private readonly banners: Pick<ContentBlockRepository, 'list'>,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
		@Optional() @Inject(MEDIA_JOB_QUEUE) private readonly queue: Pick<MediaJobQueuePort, 'enqueue'> | null = null,
	) {}

	/** P1: every registered page type, with what shows now and the next switch. */
	async pages(now = new Date()): Promise<AdminBuilderPageRow[]> {
		return Promise.all(
			registeredPageTypes().map(async (rules) => {
				const pageType = rules.key as PageTypeKey;
				const [page, layouts] = await Promise.all([
					this.layouts.page(pageType, WHOLE_PAGE),
					this.layouts.layouts(pageType, WHOLE_PAGE),
				]);
				const live = liveEntry(page?.schedule ?? [], now);
				const next = nextSwitchAt(page?.schedule ?? [], now);
				return {
					pageType,
					kind: rules.kind,
					target: WHOLE_PAGE,
					liveLayoutName: layouts.find((layout) => layout.id === live?.layoutId)?.name ?? null,
					nextSwitchAt: next ? next.toISOString() : null,
					layoutCount: layouts.length,
				};
			}),
		);
	}

	/** A1: what shoppers see and when, and the page's layouts with their status. */
	async page(type: string, now = new Date()): Promise<AdminBuilderPage> {
		const pageType = this.requireType(type);
		const [page, layouts] = await Promise.all([
			this.layouts.page(pageType, WHOLE_PAGE),
			this.layouts.layouts(pageType, WHOLE_PAGE),
		]);
		const schedule = page?.schedule ?? [];
		const next = nextSwitchAt(schedule, now);
		const settings = page?.settings ?? NO_SETTINGS;
		const names = new Map(layouts.map((layout) => [layout.id, layout.name]));
		const live = liveEntry(schedule, now);
		const previous = previousLiveEntry(schedule, live);
		const switches = await this.settings.get('storefront.pageBuilder');
		return {
			pageType,
			target: WHOLE_PAGE,
			schedule,
			liveRevisionId: live?.revisionId ?? null,
			nextSwitchAt: next ? next.toISOString() : null,
			layouts: await Promise.all(layouts.map((layout) => this.row(layout, schedule, now))),
			settings,
			settingsGaps: pageSettingsGaps(settings, this.languages.shop()),
			shareImageUrl: await this.shareImageUrl(settings),
			builderOn: drawsBuilder(switches?.[pageType], live, page?.safeMode ?? null),
			safeMode: page?.safeMode ? { ...page.safeMode, byName: await this.adminName(page.safeMode.by) } : null,
			putBack:
				previous && names.has(previous.layoutId)
					? {
							layoutId: previous.layoutId,
							layoutName: names.get(previous.layoutId) as string,
							revisionId: previous.revisionId,
						}
					: null,
			waiting: (page?.pending ?? []).map((row) => ({
				layoutId: row.entry.layoutId,
				layoutName: names.get(row.entry.layoutId) ?? '',
				from: row.entry.from,
				requestedAt: row.requestedAt,
			})),
			templates: pageType === 'home' ? await this.homeTemplates() : [],
		};
	}

	/**
	 * P3: the page's own settings. Like the legal pages, they save only when every language the shop shows has its
	 * search title, description and main heading; a refusal lists each missing language and field.
	 */
	async saveSettings(
		actor: string | null,
		type: string,
		write: PageSettings,
		now = new Date(),
	): Promise<AdminBuilderPage> {
		const pageType = this.requireType(type);
		const settings = pageSettingsToSave(write);
		const missing = Object.entries(pageSettingsGaps(settings, this.languages.shop())).flatMap(([locale, fields]) =>
			fields.map((field) => ({ locale, field })),
		);
		if (missing.length) {
			throw new BadRequestException({
				message: 'Validation failed',
				issues: missing.map(({ locale, field }) => ({
					path: [field, locale],
					message:
						'The search title, description and main heading are needed in every language the shop shows',
					code: 'page_settings_incomplete',
				})),
			});
		}
		await this.layouts.saveSettings(pageType, WHOLE_PAGE, settings, now.toISOString());
		await this.record(actor, 'page_builder.settings.save', `${pageType}:${WHOLE_PAGE}`, {
			pageType,
			headingShown: settings.headingShown,
			shareImage: settings.shareImage?.assetId ?? null,
		});
		return this.page(pageType, now);
	}

	/** SG-17: every switch still ahead, on every page, soonest first. */
	async comingUp(now = new Date()): Promise<ComingUpResponse> {
		const rows = await Promise.all(
			registeredPageTypes().map(async (rules) => {
				const pageType = rules.key as PageTypeKey;
				const [page, layouts] = await Promise.all([
					this.layouts.page(pageType, WHOLE_PAGE),
					this.layouts.layouts(pageType, WHOLE_PAGE),
				]);
				return comingUp({ pageType, target: WHOLE_PAGE, schedule: page?.schedule ?? [] }, layouts, now);
			}),
		);
		const moment = (row: ComingUpResponse['rows'][number]) =>
			// comingUp lists a switch showing now only while it has an end, as core's own sort reads it.
			Date.parse(row.state === 'showing' ? (row.until as string) : row.from);
		return { rows: rows.flat().sort((a, b) => moment(a) - moment(b)) };
	}

	/** The page's share picture: its link preview size when the photo has one, else its largest picture. */
	private async shareImageUrl(settings: PageSettings): Promise<string | null> {
		const share = settings.shareImage;
		if (!share) return null;
		const asset = await this.assets.findById(share.assetId).catch(() => null);
		if (!asset || asset.deletedAt) return null;
		const image = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
			versionId: share.versionId,
		});
		if (!image) return null;
		// resolveImage answers null for a photo with no files and puts every file it keeps in a role, so one is here.
		const files = Object.values(image.roles).flat();
		const best =
			image.roles['share']?.at(-1) ?? (files.sort((a, b) => b.width - a.width)[0] as (typeof files)[number]);
		return best.url;
	}

	/** Home's templates with their outlines (A1, Q9 A), drawn from today's banners where a template uses them. */
	private async homeTemplates(): Promise<AdminBuilderPage['templates']> {
		const context = await this.templateContext(true);
		return HOME_TEMPLATES.map((template) => ({
			key: template.key,
			outline: templateSections(template.key, context).map((section) => ({
				type: section.type,
				arrangement: section.type === 'banner_arrangement' ? section.arrangement : null,
			})),
		}));
	}

	private async templateContext(bringPictures: boolean) {
		const [banners, home] = await Promise.all([
			this.banners.list({ ownerType: 'home', status: 'active' }),
			this.settings.get('storefront.home'),
		]);
		return { banners, heroLayout: home?.heroLayout ?? ('hero_full' as const), bringPictures };
	}

	/** A2: a new layout: blank, a copy of another layout's draft (or last live revision), or a template (Q8, Q9). */
	async createLayout(
		actor: string | null,
		type: string,
		request: CreateLayoutRequest,
		now = new Date(),
	): Promise<AdminLayoutView> {
		const pageType = this.requireType(type);
		const at = now.toISOString();
		let sections: PageSection[] = [];
		if (request.start === 'copy') {
			const source = await this.requireLayout(request.copyOf ?? '');
			if (source.pageType !== pageType) throw new NotFoundException('No such layout on this page');
			const revision = await this.layouts.revision(source.draftRevisionId ?? source.lastLiveRevisionId ?? '');
			sections = revision?.sections ?? [];
		}
		let template: string | null = null;
		if (request.start === 'template') {
			if (pageType !== 'home' || !isHomeTemplate(request.template ?? '')) {
				throw new NotFoundException('No such template on this page');
			}
			template = request.template;
			sections = templateSections(
				request.template as Parameters<typeof templateSections>[0],
				await this.templateContext(request.bringPictures),
			);
		}
		const layout: PageLayout = {
			id: `lay_${randomUUID()}`,
			pageType,
			target: WHOLE_PAGE,
			name: request.name,
			template,
			draftRevisionId: null,
			lastLiveRevisionId: null,
			createdAt: at,
			updatedAt: at,
			updatedBy: actor,
			reviewRequest: null,
		};
		await this.layouts.createLayout(layout);
		if (sections.length) {
			await this.layouts.saveDraft({ layoutId: layout.id, sections, expectedDraftId: null, by: actor, at });
		}
		await this.record(actor, 'page_layout.create', layout.id, {
			pageType,
			start: request.start,
			copyOf: request.copyOf,
			template,
		});
		return this.layoutView(layout.id);
	}

	/** A layout open in the builder: its draft, what holds its Go Live, what Add section offers and who is editing. */
	async layoutView(id: string, viewer: string | null = null, now = new Date()): Promise<AdminLayoutView> {
		const layout = await this.requireLayout(id);
		const held = await this.layouts.currentLock(id, new Date(now.getTime() - LOCK_MS).toISOString());
		const draft = layout.draftRevisionId ? await this.layouts.revision(layout.draftRevisionId) : null;
		const rules = pageTypeRules(layout.pageType);
		const sections = draft?.sections ?? [];
		const problems = await this.problemsFor(layout.pageType, sections);
		return {
			layout,
			draft,
			problems,
			updatedByName: await this.adminName(layout.updatedBy),
			allowedSections: [...(rules?.slots['main'] ?? [])],
			lock: held ? await this.lockView(held, viewer) : null,
		};
	}

	/**
	 * What holds a revision's Go Live in the builder's own list: languages, pictures, shapes, sections (E1), and words
	 * over pictures (SG-1). A version not measured yet is sent to the worker; it waits until measured.
	 */
	async problemsFor(pageType: PageTypeKey, sections: readonly PageSection[]): Promise<LayoutProblem[]> {
		const rules = pageTypeRules(pageType);
		if (!rules) return [];
		const facts = await this.pictureFactsFor(sections);
		const fact = (assetId: string, versionId: string | null) => facts.get(`${assetId}|${versionId ?? ''}`) ?? null;
		const brand = (await this.settings.get('brand'))?.themeColor ?? DEFAULT_BRAND_COLOUR;
		const words = wordsProblems(sections, brand, (assetId, versionId) => {
			const known = fact(assetId, versionId);
			// A photo that is gone or not ready is already a problem of its own.
			return known && known.ready ? known.wordSpots : false;
		});
		await this.measure(words);
		return [
			...layoutProblems(sections, { rules, slot: 'main', shopLocales: this.languages.shop(), picture: fact }),
			...words,
		];
	}

	/**
	 * FX-8: queues a warm just after each switch on this page in the next day (and one now, after a change that
	 * shows at once). One job per page and moment, however often the schedule is saved; the nightly check queues the
	 * next day's again, in case the queue lost one. Without a queue (tests, scripts) nothing is queued.
	 */
	async warmSwitches(pageType: string, now = new Date(), includeNow = false): Promise<number> {
		if (!this.queue) return 0;
		const page = await this.layouts.page(pageType as PageTypeKey, WHOLE_PAGE);
		const moments = switchesWithin(page?.schedule ?? [], now);
		if (includeNow) moments.unshift(now);
		for (const moment of moments) {
			await this.queue
				.enqueue(
					{ type: 'page-warm', pageType, at: moment.toISOString() },
					{ delayMs: Math.max(0, moment.getTime() - now.getTime()) + WARM_AFTER_MS },
				)
				.catch(() => undefined);
		}
		return moments.length;
	}

	/** Refuses a draft change on a page this admin may not build (SG-19): by page type, or by one of its layouts. */
	async assertMayDraft(
		permissions: readonly string[],
		ref: { pageType: string } | { layoutId: string },
	): Promise<void> {
		const pageType = 'pageType' in ref ? ref.pageType : (await this.requireLayout(ref.layoutId)).pageType;
		if (!pageTypeRules(pageType)) throw new NotFoundException('No such page');
		if (!mayDraftPage(permissions, pageType)) throw new ForbiddenException('You may not build this page');
	}

	/**
	 * The builder's picture map (P5): how the words read over each of the nine spots of the picture's computer and phone
	 * versions, for every colour choice, so the popup redraws at once as the colours or the spot change. A version not
	 * measured yet is sent to the worker and answers `measuring`; a photo stored without a version can't be measured.
	 */
	async wordsMap(query: WordsMapQuery): Promise<WordsMap> {
		const brand = (await this.settings.get('brand'))?.themeColor ?? DEFAULT_BRAND_COLOUR;
		const wanted = [
			{ band: 'desktop' as const, assetId: query.desktop, versionId: query.desktopVersion ?? null },
			...(query.phone
				? [{ band: 'phone' as const, assetId: query.phone, versionId: query.phoneVersion ?? null }]
				: [{ band: 'phone' as const, assetId: query.desktop, versionId: query.desktopVersion ?? null }]),
		];
		const bands: WordsMapBand[] = [];
		for (const want of wanted) {
			const asset = await this.assets.findById(want.assetId).catch(() => null);
			const facts = pictureFacts(asset, want.versionId);
			if (!asset || !facts) continue;
			const files = asset.derivatives
				.filter((file) => (want.versionId ? file.versionId === want.versionId : true))
				.sort((a, b) => a.width - b.width);
			// About 480 wide is enough to draw the map in the popup.
			const file = files.find((each) => each.width >= 480) ?? files.at(-1);
			const measured = facts.ready && facts.wordSpots ? facts.wordSpots : null;
			const state = facts.wordSpots === false ? 'unmeasurable' : measured ? 'ready' : 'measuring';
			if (state === 'measuring' && want.versionId && this.queue) {
				await this.queue
					.enqueue({ type: 'word-spots', assetId: want.assetId, versionId: want.versionId })
					.catch(() => undefined);
			}
			bands.push({
				band: want.band,
				assetId: want.assetId,
				versionId: want.versionId,
				url: file ? this.storage.getUrl(file.storageKey) : null,
				ratio: facts.ratio,
				state,
				choices: measured ? wordsMap(measured, brand, want.band) : {},
			});
		}
		return { bands };
	}

	/** Sends each unmeasured version to the worker once per call (the job skips one already measured). */
	private async measure(words: readonly LayoutProblem[]): Promise<void> {
		if (!this.queue) return;
		const asked = new Set<string>();
		for (const problem of words) {
			if (problem.kind !== 'words_unmeasured' || !problem.versionId) continue;
			const key = `${problem.assetId}|${problem.versionId}`;
			if (asked.has(key)) continue;
			asked.add(key);
			await this.queue
				.enqueue({ type: 'word-spots', assetId: problem.assetId, versionId: problem.versionId })
				.catch(() => undefined);
		}
	}

	/**
	 * E4: takes or keeps the editing lock. The builder beats every 30 s; a second admin gets `granted: false` with who
	 * holds it and since when, and can look and preview until it is free.
	 */
	async lock(actor: string | null, id: string, now = new Date()): Promise<LayoutLockResponse> {
		if (!actor) throw new NotFoundException('No such layout');
		await this.requireLayout(id);
		const held = await this.layouts.lock({
			layoutId: id,
			by: actor,
			at: now.toISOString(),
			staleBefore: new Date(now.getTime() - LOCK_MS).toISOString(),
		});
		if (!held) throw new NotFoundException('No such layout');
		return { granted: held.holder === actor, lock: await this.lockView(held, actor) };
	}

	async unlock(actor: string | null, id: string): Promise<void> {
		if (actor) await this.layouts.unlock(id, actor);
	}

	private async lockView(held: HeldLock, viewer: string | null): Promise<LayoutLock> {
		return {
			holderId: held.holder,
			holderName: await this.adminName(held.holder),
			since: held.since,
			heartbeatAt: held.heartbeatAt,
			mine: held.holder === viewer,
		};
	}

	/**
	 * Saves the draft over the revision the editor started from. A save over a newer one (another admin, another
	 * tab) is refused with who saved it and when (FX-11); nothing is lost, the editor keeps its changes.
	 */
	async saveDraft(
		actor: string | null,
		id: string,
		request: SaveLayoutDraft,
		now = new Date(),
	): Promise<AdminLayoutView> {
		const layout = await this.requireLayout(id);
		// Another admin is editing (E4): this one may look and preview, not save over them.
		const held = await this.layouts.currentLock(id, new Date(now.getTime() - LOCK_MS).toISOString());
		if (held && held.holder !== actor) {
			throw new HttpException(
				{
					message: 'Someone else is editing this layout',
					code: 'layout_locked',
					holderName: await this.adminName(held.holder),
					since: held.since,
				},
				HttpStatus.LOCKED,
			);
		}
		const saved = await this.layouts.saveDraft({
			layoutId: id,
			sections: request.sections,
			expectedDraftId: request.expectedDraftId,
			by: actor,
			at: now.toISOString(),
		});
		if (!saved) {
			const current = await this.requireLayout(id);
			throw new ConflictException({
				message: 'This layout was saved by someone else since you opened it',
				code: 'layout_moved_on',
				savedBy: await this.adminName(current.updatedBy),
				savedAt: current.updatedAt,
				draftRevisionId: current.draftRevisionId,
			});
		}
		await this.record(actor, 'page_layout.save_draft', layout.id, { revision: saved.number });
		return this.layoutView(id, actor, now);
	}

	async rename(
		actor: string | null,
		id: string,
		request: RenameLayoutRequest,
		now = new Date(),
	): Promise<AdminLayoutView> {
		const layout = await this.requireLayout(id);
		await this.layouts.renameLayout(id, request.name, layout.template, actor, now.toISOString());
		await this.record(actor, 'page_layout.rename', id, { from: layout.name, to: request.name });
		return this.layoutView(id);
	}

	/**
	 * The shop: a page's live layout for one language (brief, How the shop draws it). Read on every request, so the
	 * schedule decides what shows without any job (FX-6); `refreshAt` is the next moment the answer may change.
	 */
	async shopLayout(type: string, locale: string, now = new Date()): Promise<StorefrontPageLayout> {
		const pageType = this.requireType(type);
		const page = await this.layouts.page(pageType, WHOLE_PAGE);
		// The page's own settings apply whichever page is drawn, the fixed one included (P3).
		const pageSettings = page?.settings
			? shopPageSettings(page.settings, locale, await this.shareImageUrl(page.settings))
			: null;
		const schedule = page?.schedule ?? [];
		const live = liveEntry(schedule, now);
		// The fixed page (also the fallback and the safe mode, SG-15) until someone's Go Live has started.
		const switches = await this.settings.get('storefront.pageBuilder');
		if (!drawsBuilder(switches?.[pageType], live, page?.safeMode ?? null)) {
			const next = nextSwitchAt(schedule, now);
			return {
				pageType,
				revisionId: null,
				sections: [],
				refreshAt: next ? next.toISOString() : null,
				settings: pageSettings,
			};
		}
		const revision = live ? await this.layouts.revision(live.revisionId) : null;
		return this.drawn(pageType, revision, schedule, locale, now, pageSettings);
	}

	/**
	 * A revision as the shop draws it in one language: every picture resolved to its stored version, and the next
	 * moment the answer may change. Shared by the live page and the preview of a draft (step 6).
	 */
	async drawn(
		pageType: PageTypeKey,
		revision: { id: string; sections: PageSection[] } | null,
		schedule: AdminBuilderPage['schedule'],
		locale: string,
		now: Date,
		pageSettings: StorefrontPageLayout['settings'],
	): Promise<StorefrontPageLayout> {
		const sections = revision?.sections ?? [];
		const ids = new Set<string>();
		for (const section of sections) {
			if (!('pieces' in section)) continue;
			for (const picture of section.pieces.flatMap((piece) => piece.pictures)) {
				for (const set of [picture.images, ...Object.values(picture.localeImages)]) {
					for (const id of [set.desktop, set.tablet, set.phone]) if (id) ids.add(id);
				}
			}
		}
		const assets = new Map((await this.assets.findManyByIds([...ids])).map((asset) => [asset.id, asset]));
		const resolved = shopSections(sections, {
			locale,
			now,
			image: (assetId, versionId) => {
				const asset = assets.get(assetId);
				if (!asset || asset.deletedAt) return null;
				return resolveImage({
					asset,
					getUrl: (key) => this.storage.getUrl(key),
					locale,
					fallbackLocale: 'en',
					versionId,
				});
			},
		});
		const moments = [nextSwitchAt(schedule, now), nextContentChangeAt(sections, now)].filter(
			(moment): moment is Date => moment !== null,
		);
		const refreshAt = moments.length ? new Date(Math.min(...moments.map((moment) => moment.getTime()))) : null;
		return {
			pageType,
			revisionId: revision?.id ?? null,
			sections: resolved,
			refreshAt: refreshAt ? refreshAt.toISOString() : null,
			settings: pageSettings,
		};
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

	private async row(layout: PageLayout, schedule: AdminBuilderPage['schedule'], now: Date): Promise<AdminLayoutRow> {
		const { status, from, until } = layoutStatus(layout.id, schedule, now);
		const draft = await this.layouts.revision(layout.draftRevisionId ?? layout.lastLiveRevisionId ?? '');
		const outline = (draft?.sections ?? [])
			.filter((section) => !section.hidden)
			.map((section) => ({
				type: section.type,
				arrangement: section.type === 'banner_arrangement' ? section.arrangement : null,
			}));
		return { layout, status, from, until, updatedByName: await this.adminName(layout.updatedBy), outline };
	}

	private async pictureFactsFor(sections: readonly PageSection[]): Promise<Map<string, PictureFacts | null>> {
		const wanted = new Map<string, string | null>();
		for (const section of sections) {
			if (!('pieces' in section)) continue;
			for (const piece of section.pieces) {
				for (const picture of piece.pictures) {
					for (const assetId of [picture.images.desktop, picture.images.tablet, picture.images.phone]) {
						if (assetId)
							wanted.set(
								`${assetId}|${picture.versions[assetId] ?? ''}`,
								picture.versions[assetId] ?? null,
							);
					}
				}
			}
		}
		const assets = new Map<string, MediaAsset | null>();
		await Promise.all(
			[...new Set([...wanted.keys()].map((key) => key.split('|')[0] as string))].map(async (assetId) => {
				assets.set(assetId, await this.assets.findById(assetId).catch(() => null));
			}),
		);
		const facts = new Map<string, PictureFacts | null>();
		for (const [key, versionId] of wanted) {
			// Every photo asked for was read above, as itself or as null.
			facts.set(key, pictureFacts(assets.get(key.split('|')[0] as string) as MediaAsset | null, versionId));
		}
		return facts;
	}

	async adminName(id: string | null): Promise<string | null> {
		if (!id) return null;
		const admin = await this.admins.findById(id).catch(() => null);
		return admin ? (admin.displayName ?? admin.username ?? admin.email ?? null) : null;
	}

	async record(
		actor: string | null,
		action: string,
		entityId: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action,
			entityType: 'page_layout',
			entityId,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata,
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}

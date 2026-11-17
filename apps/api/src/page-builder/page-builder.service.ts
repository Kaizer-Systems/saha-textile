import { randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
	AdminBuilderPage,
	AdminBuilderPageRow,
	AdminLayoutRow,
	AdminLayoutView,
	AuditLog,
	CreateLayoutRequest,
	MediaAsset,
	PageLayout,
	PageSection,
	PageTypeKey,
	RenameLayoutRequest,
	SaveLayoutDraft,
	StorefrontPageLayout,
} from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AuditLogRepository,
	type MediaAssetRepository,
	type PageLayoutRepository,
	type PictureFacts,
	layoutProblems,
	layoutStatus,
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
	PAGE_LAYOUT_REPOSITORY,
	SITE_SETTINGS_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';
import { LanguageStore } from '../languages/language-store';

const WHOLE_PAGE = 'page';

/** A photo version's facts for the Go Live checks: ready to show, and its shape from the files it made. */
export function pictureFacts(asset: MediaAsset | null, versionId: string | null): PictureFacts | null {
	if (!asset || asset.deletedAt) return null;
	const version = versionId ? (asset.versions ?? []).find((candidate) => candidate.id === versionId) : null;
	if (versionId && !version) return null;
	const ready = version ? version.state === 'ready' : asset.processing.state === 'ready';
	const files = asset.derivatives.filter((file) => (versionId ? file.versionId === versionId : true));
	const widest = [...files].sort((a, b) => b.width - a.width)[0];
	const ratio = widest
		? widest.width / widest.height
		: asset.width && asset.height
			? asset.width / asset.height
			: null;
	return { ready, ratio };
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
		return {
			pageType,
			target: WHOLE_PAGE,
			schedule,
			liveRevisionId: liveEntry(schedule, now)?.revisionId ?? null,
			nextSwitchAt: next ? next.toISOString() : null,
			layouts: await Promise.all(layouts.map((layout) => this.row(layout, schedule, now))),
			templates: pageType === 'home' ? await this.homeTemplates() : [],
		};
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

	/** A layout open in the builder: its draft and what holds its Go Live. */
	async layoutView(id: string): Promise<AdminLayoutView> {
		const layout = await this.requireLayout(id);
		const draft = layout.draftRevisionId ? await this.layouts.revision(layout.draftRevisionId) : null;
		const rules = pageTypeRules(layout.pageType);
		const sections = draft?.sections ?? [];
		const facts = await this.pictureFactsFor(sections);
		const problems = rules
			? layoutProblems(sections, {
					rules,
					slot: 'main',
					shopLocales: this.languages.shop(),
					picture: (assetId, versionId) => facts.get(`${assetId}|${versionId ?? ''}`) ?? null,
				})
			: [];
		return { layout, draft, problems, updatedByName: await this.adminName(layout.updatedBy) };
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
		return this.layoutView(id);
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
		// Off (the default): the shop draws its fixed page, which is also the fallback and the safe mode (SG-15).
		const switches = await this.settings.get('storefront.pageBuilder');
		if (!switches?.[pageType]) return { pageType, revisionId: null, sections: [], refreshAt: null };
		const schedule = (await this.layouts.page(pageType, WHOLE_PAGE))?.schedule ?? [];
		const live = liveEntry(schedule, now);
		const revision = live ? await this.layouts.revision(live.revisionId) : null;
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
			facts.set(key, pictureFacts(assets.get(key.split('|')[0] as string) ?? null, versionId));
		}
		return facts;
	}

	private async adminName(id: string | null): Promise<string | null> {
		if (!id) return null;
		const admin = await this.admins.findById(id).catch(() => null);
		return admin ? (admin.displayName ?? admin.username ?? admin.email ?? null) : null;
	}

	private async record(
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

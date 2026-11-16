import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
	type AdminLegalPage,
	type AuditLog,
	LEGAL_PAGE_SLUGS,
	type LegalPage,
	type LegalPageSlug,
	type LegalPageWrite,
	type PublicLegalPage,
} from '@saha-textile/contracts';
import {
	type AdminUserRepository,
	type AuditLogRepository,
	type LegalPageRepository,
	type MediaAssetRepository,
	type StoragePort,
	legalPageGaps,
	legalPageText,
	legalPageToSave,
	resolveImage,
} from '@saha-textile/core-domain';

import { LanguageStore } from '../languages/language-store';
import {
	ADMIN_USER_REPOSITORY,
	AUDIT_LOG_REPOSITORY,
	LEGAL_PAGE_REPOSITORY,
	MEDIA_ASSET_REPOSITORY,
	STORAGE_PORT,
} from '../infra/tokens';

const isSlug = (slug: string): slug is LegalPageSlug => (LEGAL_PAGE_SLUGS as readonly string[]).includes(slug);

/**
 * The four legal pages (Legal Pages brief, approved 15 Nov 2026). The admin lists and saves them; a save needs Title
 * and Content in every language the shop shows (draft languages may wait, as their to-dos), cleans the content, keeps
 * the earlier version and is audited. The shop reads one language of a page, falling back to English.
 */
@Injectable()
export class LegalPagesService {
	constructor(
		@Inject(LEGAL_PAGE_REPOSITORY) private readonly pages: LegalPageRepository,
		private readonly languages: LanguageStore,
		@Inject(ADMIN_USER_REPOSITORY) private readonly admins: Pick<AdminUserRepository, 'findById'>,
		@Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: Pick<MediaAssetRepository, 'findById'>,
		@Inject(STORAGE_PORT) private readonly storage: Pick<StoragePort, 'getUrl'>,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async list(): Promise<AdminLegalPage[]> {
		const stored = new Map((await this.pages.list()).map((page) => [page.slug, page]));
		return Promise.all(
			LEGAL_PAGE_SLUGS.flatMap((slug) => (stored.get(slug) ? [this.view(stored.get(slug) as LegalPage)] : [])),
		);
	}

	async get(slug: string): Promise<AdminLegalPage> {
		return this.view(await this.require(slug));
	}

	async save(actor: string | null, slug: string, write: LegalPageWrite, now = new Date()): Promise<AdminLegalPage> {
		const current = await this.require(slug);
		const gaps = legalPageGaps(write, this.languages.shop());
		const missing = Object.entries(gaps).flatMap(([locale, fields]) => fields.map((field) => ({ locale, field })));
		if (missing.length) {
			throw new BadRequestException({
				message: 'Title and Content are needed in every language the shop shows',
				code: 'legal_page_incomplete',
				missing,
			});
		}
		const page = legalPageToSave({ slug: current.slug, write, current, actor, now });
		await this.pages.save(page, current);
		await this.record(actor, page);
		return this.view(page);
	}

	/** The shop: one language of a page, English where that language is empty. Unknown slugs are not found. */
	async publicPage(slug: string, locale: string): Promise<PublicLegalPage> {
		const page = await this.require(slug);
		const title = legalPageText(page.title, locale);
		return {
			slug: page.slug,
			title,
			content: legalPageText(page.content, locale),
			metaTitle: legalPageText(page.metaTitle, locale),
			metaDescription: legalPageText(page.metaDescription, locale),
			shareImageUrl: await this.shareImage(page.metaImageAssetId),
			updatedAt: page.updatedAt,
		};
	}

	private async require(slug: string): Promise<LegalPage> {
		const page = isSlug(slug) ? await this.pages.find(slug) : null;
		if (!page) throw new NotFoundException('No such page');
		return page;
	}

	private async view(page: LegalPage): Promise<AdminLegalPage> {
		const admin = page.updatedBy ? await this.admins.findById(page.updatedBy).catch(() => null) : null;
		return {
			page,
			updatedByName: admin ? (admin.displayName ?? admin.username ?? admin.email ?? null) : null,
			gaps: legalPageGaps(page, this.languages.content()),
			metaImageUrl: await this.shareImage(page.metaImageAssetId),
		};
	}

	private async shareImage(assetId: string | null): Promise<string | null> {
		if (!assetId) return null;
		const asset = await this.assets.findById(assetId).catch(() => null);
		if (!asset || asset.deletedAt) return null;
		const image = resolveImage({
			asset,
			getUrl: (key) => this.storage.getUrl(key),
			locale: 'en',
			fallbackLocale: 'en',
		});
		// The link preview size when the photo has one, else its largest picture.
		const sources = image ? [...(image.roles['share'] ?? []), ...Object.values(image.roles).flat()] : [];
		const best = image?.roles['share']?.at(-1) ?? [...sources].sort((a, b) => b.width - a.width)[0];
		return best?.url ?? null;
	}

	private async record(actor: string | null, page: LegalPage): Promise<void> {
		if (!this.audit) return;
		const entry: AuditLog = {
			id: `audit_${randomUUID()}`,
			actorUserId: actor,
			targetUserId: null,
			audience: 'admin',
			action: 'legal_page.save',
			entityType: 'legal_page',
			entityId: page.slug,
			severity: 'info',
			retentionTier: 'catalog_admin',
			diffs: [],
			metadata: { version: page.version },
			requestId: null,
			ipHash: null,
			userAgentHash: null,
			createdAt: new Date().toISOString(),
		};
		await this.audit.append(entry);
	}
}

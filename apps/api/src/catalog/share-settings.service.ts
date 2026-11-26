import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { type AuditLog, BrandSettings, StorefrontShareSettings, xHandleFromUrl } from '@saha-textile/contracts';
import type { AuditLogRepository, SiteSettingsRepository } from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY, SITE_SETTINGS_REPOSITORY } from '../infra/tokens';

/**
 * Storefront settings › Sharing (share brief D4): read by the share menu, saved by the admin, audited.
 *
 * The X account is not stored here (owner, 2026-11-10): it is the Brand Kit's X profile, shown in
 * both screens. Reading turns the profile address into the handle; saving writes the address back
 * into the Brand Kit, so either screen changes the one stored value.
 */
@Injectable()
export class ShareSettingsService {
	constructor(
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async get(): Promise<StorefrontShareSettings> {
		const stored = StorefrontShareSettings.parse((await this.settings.get('storefront.share')) ?? {});
		const brand = await this.brand();
		// A handle saved here before it moved to the Brand Kit still counts until the Brand Kit has one.
		return { ...stored, xHandle: xHandleFromUrl(brand.socials.x) || stored.xHandle };
	}

	async save(body: StorefrontShareSettings, actorUserId: string | null): Promise<StorefrontShareSettings> {
		const settings = StorefrontShareSettings.parse({ ...body, apps: [...new Set(body.apps)] });
		await this.settings.set('storefront.share', { ...settings, xHandle: '' });
		const brand = await this.brand();
		const x = settings.xHandle ? `https://x.com/${settings.xHandle}` : '';
		if (xHandleFromUrl(brand.socials.x) !== settings.xHandle) {
			await this.settings.set('brand', { ...brand, socials: { ...brand.socials, x } });
		}
		if (this.audit) {
			const entry: AuditLog = {
				id: `audit_${randomUUID()}`,
				actorUserId,
				targetUserId: null,
				audience: 'admin',
				action: 'storefront.settings.share',
				entityType: 'site_setting',
				entityId: 'storefront.share',
				severity: 'info',
				retentionTier: 'catalog_admin',
				diffs: [],
				metadata: { ...settings },
				requestId: null,
				ipHash: null,
				userAgentHash: null,
				createdAt: new Date().toISOString(),
			};
			await this.audit.append(entry);
		}
		return settings;
	}

	private async brand(): Promise<BrandSettings> {
		return BrandSettings.parse((await this.settings.get('brand')) ?? {});
	}
}

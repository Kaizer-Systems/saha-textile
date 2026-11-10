import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { type AuditLog, StorefrontShareSettings } from '@saha-textile/contracts';
import type { AuditLogRepository, SiteSettingsRepository } from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY, SITE_SETTINGS_REPOSITORY } from '../infra/tokens';

/** Storefront settings › Sharing (share brief D4): read by the share menu, saved by the admin, audited. */
@Injectable()
export class ShareSettingsService {
	constructor(
		@Inject(SITE_SETTINGS_REPOSITORY) private readonly settings: SiteSettingsRepository,
		@Optional() @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository | null = null,
	) {}

	async get(): Promise<StorefrontShareSettings> {
		return StorefrontShareSettings.parse((await this.settings.get('storefront.share')) ?? {});
	}

	async save(body: StorefrontShareSettings, actorUserId: string | null): Promise<StorefrontShareSettings> {
		const settings = StorefrontShareSettings.parse({ ...body, apps: [...new Set(body.apps)] });
		await this.settings.set('storefront.share', settings);
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
}

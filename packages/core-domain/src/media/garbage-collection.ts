import type { AuditLog, MediaAsset } from '@saha-textile/contracts';

import type { AuditLogRepository } from '../ports/governance.repository';
import type { MediaJobQueuePort } from '../ports/media-job-queue.port';
import type { MediaAssetRepository } from '../ports/media.repository';
import type { StoragePort } from '../ports/storage.port';
import { MEDIA_INGEST_POLICY } from './policy';

export interface MediaGcDeps {
	assets: MediaAssetRepository;
	storage: StoragePort;
	queue: MediaJobQueuePort;
	audit: AuditLogRepository;
	now: () => Date;
	newId: () => string;
}

export interface MediaGcReport {
	dryRun: boolean;
	softDeleted: string[];
	restored: string[];
	hardDeleted: string[];
}

const HOUR = 3_600_000;
const PAGE = 200;

/**
 * Orphan collection (owner lock: soft delete, 30-day grace, then hard delete).
 *
 * Pass 1 soft-deletes live assets no owner references — skipping anything younger than the
 * recency guard, because an admin may have uploaded it a minute ago and not attached it yet.
 * Pass 2 takes soft-deleted assets past their grace: one that gained an owner meanwhile is
 * restored; the rest have their objects deleted and CDN URLs purged (as a queued job) and
 * their record removed. Reference counts are re-checked immediately before every write.
 *
 * `dryRun` reports what would happen and writes nothing but the audit record, which every
 * run leaves either way.
 */
export const runMediaGarbageCollection = async (
	deps: MediaGcDeps,
	options: { dryRun: boolean },
): Promise<MediaGcReport> => {
	const now = deps.now();
	const report: MediaGcReport = { dryRun: options.dryRun, softDeleted: [], restored: [], hardDeleted: [] };

	const createdBefore = new Date(now.getTime() - MEDIA_INGEST_POLICY.gcRecencyGuardHours * HOUR).toISOString();
	let afterId: string | null = null;
	for (;;) {
		const page = await deps.assets.listLiveCreatedBefore({ createdBefore, afterId, limit: PAGE });
		for (const asset of page) {
			if ((await deps.assets.countReferences(asset.id)) > 0) continue;
			report.softDeleted.push(asset.id);
			if (!options.dryRun) await deps.assets.softDelete(asset.id, now.toISOString());
		}
		if (page.length < PAGE) break;
		afterId = (page[page.length - 1] as MediaAsset).id;
	}

	const deletedBefore = new Date(now.getTime() - MEDIA_INGEST_POLICY.gcGraceDays * 24 * HOUR).toISOString();
	for (;;) {
		const orphans = await deps.assets.listOrphans({ deletedBefore, limit: PAGE });
		const work = orphans.filter(
			(asset) => !report.restored.includes(asset.id) && !report.hardDeleted.includes(asset.id),
		);
		if (work.length === 0) break;
		for (const asset of work) {
			if ((await deps.assets.countReferences(asset.id)) > 0) {
				report.restored.push(asset.id);
				if (!options.dryRun) await deps.assets.restore(asset.id);
				continue;
			}
			report.hardDeleted.push(asset.id);
			if (!options.dryRun) await purgeAsset(deps, asset);
		}
		if (options.dryRun || orphans.length < PAGE) break;
	}

	const entry: AuditLog = {
		id: deps.newId(),
		actorUserId: null,
		targetUserId: null,
		audience: 'system',
		action: 'media.gc.run',
		entityType: 'mediaAsset',
		entityId: null,
		severity: 'info',
		retentionTier: 'catalog_admin',
		diffs: [],
		metadata: {
			dryRun: options.dryRun,
			softDeleted: report.softDeleted.length,
			restored: report.restored.length,
			hardDeleted: report.hardDeleted.length,
			hardDeletedIds: report.hardDeleted.slice(0, 500),
		},
		requestId: null,
		ipHash: null,
		userAgentHash: null,
		createdAt: now.toISOString(),
	};
	await deps.audit.append(entry);
	return report;
};

/** Every object an asset owns goes, public URLs are purged, then the record. */
export const purgeAsset = async (
	deps: Pick<MediaGcDeps, 'assets' | 'storage' | 'queue'>,
	asset: MediaAsset,
): Promise<void> => {
	const keys = asset.derivatives.map((derivative) => derivative.storageKey);
	if (asset.originalStorageKey) keys.push(asset.originalStorageKey);
	const urls =
		asset.visibility === 'public'
			? asset.derivatives.map((derivative) => deps.storage.getUrl(derivative.storageKey))
			: [];
	if (keys.length > 0) await deps.queue.enqueue({ type: 'delete-objects', keys, urls });
	await deps.assets.hardDelete(asset.id);
};

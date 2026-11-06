import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { CloudflareCdnPurge } from '@saha-textile/adapters-cdn-cloudflare';
import {
	MongoAuditLogRepository,
	MongoConsentRepository,
	MongoCustomerRepository,
	MongoMediaAssetRepository,
	MongoMediaRoleRepository,
	MongoMessageOutboxRepository,
	MongoNotificationSettingsRepository,
	MongoNotificationTemplateRepository,
	MongoOrderRepository,
	MongoProductInsightSetRepository,
	MongoProductRelationRepository,
	MongoProductRepository,
	MongoProductVariantRepository,
	MongoSiteSettingsRepository,
	MongoStockAlertRepository,
} from '@saha-textile/adapters-db-mongo';
import { SharpImageCodec } from '@saha-textile/adapters-image-sharp';
import { BullMqMediaJobQueue, type MediaJobHandlers, startMediaWorker } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { YouTubeDataApi } from '@saha-textile/adapters-youtube';
import {
	type CdnPurgePort,
	deliverStockAlerts,
	processMediaAsset,
	reconcileSeededRoles,
	refreshYouTubeFeed,
	runMediaGarbageCollection,
	runWeeklyInsight,
} from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { LogOnlyCdnPurgeAdapter } from '../infra/log-only-cdn-purge.adapter';
import { buildNotificationPort } from '../infra/notification-factory';

/** Batch size for the 15-minute stale sweep: bounded work per tick, never one giant job. */
const STALE_BATCH = 50;

/**
 * Composes the media worker: the same use cases the API enqueues, bound to the edge adapters
 * (sharp, Spaces, BullMQ, Cloudflare, YouTube). Runs as its own process — same image as the
 * API, different command — so image encoding never shares an event loop with HTTP.
 */
export const composeMediaWorker = async (config: AppConfig) => {
	const logger = new Logger('MediaWorker');
	const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
	if (!key || !secret || !bucket) {
		throw new Error('The media worker needs Spaces credentials (SPACES_KEY, SPACES_SECRET, SPACES_BUCKET).');
	}

	const assets = new MongoMediaAssetRepository();
	const roles = new MongoMediaRoleRepository();
	const settings = new MongoSiteSettingsRepository();
	const audit = new MongoAuditLogRepository();
	const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
	const codec = new SharpImageCodec();
	const queue = new BullMqMediaJobQueue(config.redis);
	const cdn: CdnPurgePort =
		config.media.cloudflareZoneId && config.media.cloudflarePurgeToken
			? new CloudflareCdnPurge({
					zoneId: config.media.cloudflareZoneId,
					apiToken: config.media.cloudflarePurgeToken,
				})
			: new LogOnlyCdnPurgeAdapter();
	const youtube = config.media.youtubeApiKey ? new YouTubeDataApi({ apiKey: config.media.youtubeApiKey }) : null;
	const now = () => new Date();
	const notifications = buildNotificationPort(config, {
		settings: new MongoNotificationSettingsRepository(),
		templates: new MongoNotificationTemplateRepository(),
		outbox: new MongoMessageOutboxRepository(),
		consent: new MongoConsentRepository(),
	});

	const processDeps = { assets, roles, storage, codec, queue, now };

	const handlers: MediaJobHandlers = {
		process: (job) => processMediaAsset(processDeps, { assetId: job.assetId, reprocess: false }),
		reprocess: (job) => processMediaAsset(processDeps, { assetId: job.assetId, reprocess: true }),
		'delete-objects': async (job) => {
			await storage.deleteMany(job.keys);
			if (job.urls.length > 0) await cdn.purgeUrls(job.urls);
		},
		purge: (job) => cdn.purgeUrls(job.urls),
		gc: async () => {
			const report = await runMediaGarbageCollection(
				{ assets, storage, queue, audit, now, newId: () => `audit_${randomUUID()}` },
				{ dryRun: !config.media.gcLive },
			);
			logger.log(
				`GC ${report.dryRun ? '(dry run) ' : ''}soft-deleted ${report.softDeleted.length}, restored ${report.restored.length}, hard-deleted ${report.hardDeleted.length}`,
			);
			return report;
		},
		'youtube-refresh': async () => {
			if (!youtube) {
				logger.warn('YouTube refresh skipped: YOUTUBE_API_KEY is not set');
				return { skipped: 'not_configured' };
			}
			return refreshYouTubeFeed({ youtube, settings, now });
		},
		'reprocess-stale': async () => {
			let queued = 0;
			for (const role of await roles.list()) {
				for (const asset of await assets.listStaleForRole({
					role: role.key,
					version: role.version,
					limit: STALE_BATCH,
				})) {
					if (!asset.originalStorageKey) continue;
					await queue.enqueue({ type: 'reprocess', assetId: asset.id, reason: 'ladder' });
					queued += 1;
				}
			}
			return { queued };
		},
		'weekly-insight': async () => {
			const result = await runWeeklyInsight({
				orders: new MongoOrderRepository(),
				products: new MongoProductRepository(),
				relations: new MongoProductRelationRepository(),
				insightSets: new MongoProductInsightSetRepository(),
				now,
			});
			logger.log(`Weekly insight ${result.insightSetId}: ${result.relations} relations`);
			return result;
		},
		'stock-alerts': async () => {
			const result = await deliverStockAlerts({
				alerts: new MongoStockAlertRepository(),
				products: new MongoProductRepository(),
				variants: new MongoProductVariantRepository(),
				customers: new MongoCustomerRepository(),
				notifications,
				now,
			});
			logger.log(`Stock alerts: ${result.sent} sent, ${result.held} held, ${result.waiting} waiting`);
			return result;
		},
	};

	const reconciled = await reconcileSeededRoles(roles);
	if (reconciled.length > 0) logger.log(`Media roles reconciled: ${reconciled.join(', ')}`);
	await queue.registerSchedules();
	const worker = startMediaWorker({
		connection: config.redis,
		handlers,
		concurrency: config.media.workerConcurrency,
		onFailed: (job, error) => logger.warn(`Job ${job?.name ?? '?'} ${job?.id ?? ''} failed: ${error.message}`),
	});
	logger.log(`Media worker consuming with concurrency ${config.media.workerConcurrency}`);

	return {
		async close() {
			await worker.close();
			await queue.close();
		},
	};
};

import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { CloudflareCdnPurge } from '@saha-textile/adapters-cdn-cloudflare';
import {
	MongoAuditLogRepository,
	MongoCommunicationSwitchRepository,
	MongoConsentRepository,
	MongoCustomerRepository,
	MongoLanguageRepository,
	MongoMediaAssetRepository,
	MongoMediaFavouriteRepository,
	MongoMediaFolderRepository,
	MongoMediaProfileRepository,
	MongoEmailPictureRepository,
	MongoMediaRoleRepository,
	MongoShareLinkRepository,
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
	MongoStorageLedgerRepository,
} from '@saha-textile/adapters-db-mongo';
import { SharpImageCodec } from '@saha-textile/adapters-image-sharp';
import { BullMqMediaJobQueue, type MediaJobHandlers, startMediaWorker } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { YouTubeDataApi } from '@saha-textile/adapters-youtube';
import {
	type CdnPurgePort,
	brandStripLogo,
	deliverStockAlerts,
	processMediaAsset,
	replaceMediaAsset,
	sweepKeptFiles,
	reconcileSeededRoles,
	checkProductVideos,
	copyYouTubePosters,
	purgeMediaTrash,
	sweepUnfinishedUploads,
	refreshYouTubeFeed,
	runMediaGarbageCollection,
	runWeeklyInsight,
	checkSpaces,
} from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { LanguageStore } from '../languages/language-store';
import { LogOnlyCdnPurgeAdapter } from '../infra/log-only-cdn-purge.adapter';
import { buildNotificationPort } from '../infra/notification-factory';
import { MeilisearchSearch, noProductsLoaded } from '../search/meilisearch-search';
import { catchUpSearch, drainSearchQueue, nightlySearchCheck } from '../search/search-release';

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
	const profiles = new MongoMediaProfileRepository();
	const emailPictures = new MongoEmailPictureRepository();
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
		switches: new MongoCommunicationSwitchRepository(),
	});

	const processDeps = {
		assets,
		roles,
		storage,
		codec,
		queue,
		now,
		brandLogo: () => brandStripLogo({ settings, assets, storage }),
		profiles,
		// An icon's Brand colour fill: the Brand Kit's theme colour.
		brandColour: async () => (await settings.get('brand'))?.themeColor ?? null,
		emailPictures,
	};
	// The worker reads Settings › Languages too: search documents carry every added language.
	const languages = new LanguageStore(new MongoLanguageRepository(), config);
	await languages.refresh().catch((error: unknown) => logger.warn(`Languages from ACTIVE_LOCALES: ${String(error)}`));
	languages.start();
	const search = new MeilisearchSearch(
		config.search.host,
		config.search.apiKey,
		noProductsLoaded,
		config.search.index,
		() => languages.content(),
	);

	const handlers: MediaJobHandlers = {
		process: (job) => processMediaAsset(processDeps, { assetId: job.assetId, reprocess: false }),
		reprocess: (job) => processMediaAsset(processDeps, { assetId: job.assetId, reprocess: true }),
		replace: (job) => replaceMediaAsset(processDeps, { assetId: job.assetId }),
		// The nightly Spaces check (R5-5): missing pictures the website uses, and files no record knows.
		'spaces-check': async () => {
			const result = await checkSpaces(
				{
					listKeys: (prefix) => storage.listKeys(prefix),
					referencedIds: () => assets.referencedIds(),
					findManyByIds: (ids) => assets.findManyByIds(ids),
					whereUsed: (ids) => assets.whereUsed(ids),
				},
				now(),
			);
			await settings.set('media_nightly_check', result);
			logger.log(
				`Spaces check: ${result.filesInSpaces} files, ${result.missingCount} used photos missing files, ${result.unrecorded.count} files without a record`,
			);
			return { missing: result.missingCount, unrecorded: result.unrecorded.count };
		},
		'kept-files-sweep': async () => {
			const swept = await sweepKeptFiles({ assets, queue, storage: processDeps.storage }, now());
			if (swept > 0) logger.log(`Kept files: ${swept} photos' files from before a Replace deleted after 7 days`);
			return swept;
		},
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
			const refreshed = await refreshYouTubeFeed({ youtube, settings, now });
			// Our CDN copies of the pictures; a failure here never undoes the refreshed list.
			const posters = await copyYouTubePosters({ youtube, codec, storage, queue, settings }).catch((error) => {
				logger.warn(`YouTube posters not copied: ${String(error)}`);
				return null;
			});
			return { ...refreshed, posters };
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
		'product-videos-check': async () => {
			if (!youtube) {
				logger.warn('Product video check skipped: YOUTUBE_API_KEY is not set');
				return { skipped: 'not_configured' };
			}
			const result = await checkProductVideos({ products: new MongoProductRepository(), youtube, now });
			logger.log(`Product videos: ${result.checked} checked, ${result.gone} gone, ${result.back} back`);
			return result;
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
		'search-outbox': async () => {
			const result = await drainSearchQueue(search);
			if (result.indexed + result.removed + result.failed > 0) {
				logger.log(
					`Search queue: ${result.indexed} indexed, ${result.removed} removed, ${result.failed} still waiting`,
				);
			}
			return result;
		},
		'search-check': async () => {
			const result = await nightlySearchCheck(search);
			logger.log(
				`Search check: ${result.live} live, ${result.indexed} indexed, ${result.missing} missing, ${result.extra} extra, ${result.requested} queued`,
			);
			return result;
		},
		'trash-purge': async () => {
			const result = await purgeMediaTrash(
				{
					emailPictures,
					actor: null,
					folders: new MongoMediaFolderRepository(),
					files: assets,
					assets,
					stars: new MongoMediaFavouriteRepository(),
					links: new MongoShareLinkRepository(),
					queue,
					publicUrl: (key) => storage.getUrl(key),
					record: (action, metadata) =>
						audit.append({
							id: `audit_${randomUUID()}`,
							actorUserId: null,
							targetUserId: null,
							audience: 'system',
							action,
							entityType: 'media',
							entityId: null,
							severity: 'info',
							retentionTier: 'catalog_admin',
							diffs: [],
							metadata,
							requestId: null,
							ipHash: null,
							userAgentHash: null,
							createdAt: now().toISOString(),
						}),
				},
				now(),
			);
			if (result.files + result.folders > 0) {
				logger.log(`Trash: ${result.files} files and ${result.folders} folders removed after 30 days`);
			}
			return result;
		},
		'upload-sweep': async () => {
			const ledger = new MongoStorageLedgerRepository();
			const swept = await sweepUnfinishedUploads(
				{
					files: assets,
					assets,
					queue,
					release: (holdId) => ledger.release(holdId),
					record: (action, metadata) =>
						audit.append({
							id: `audit_${randomUUID()}`,
							actorUserId: null,
							targetUserId: null,
							audience: 'system',
							action,
							entityType: 'media',
							entityId: null,
							severity: 'info',
							retentionTier: 'catalog_admin',
							diffs: [],
							metadata,
							requestId: null,
							ipHash: null,
							userAgentHash: null,
							createdAt: now().toISOString(),
						}),
				},
				now(),
			);
			if (swept) logger.log(`Uploads: ${swept} never finished, removed after a day`);
			return { swept };
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
	// Changes the old release took while this one's index was built or switched in.
	void catchUpSearch(search)
		.then((replayed) => {
			if (replayed) logger.log(`Search caught up: ${replayed} changes replayed`);
		})
		.catch((error: unknown) => logger.warn(`Search catch-up waits for the nightly check: ${String(error)}`));
	const worker = startMediaWorker({
		connection: config.redis,
		handlers,
		concurrency: config.media.workerConcurrency,
		onFailed: (job, error) => logger.warn(`Job ${job?.name ?? '?'} ${job?.id ?? ''} failed: ${error.message}`),
	});
	logger.log(`Media worker consuming with concurrency ${config.media.workerConcurrency}`);

	return {
		async close() {
			languages.onModuleDestroy();
			await worker.close();
			await queue.close();
		},
	};
};

import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { CloudflareCdnPurge } from '@saha-textile/adapters-cdn-cloudflare';
import {
	MongoAuditLogRepository,
	MongoCommunicationSwitchRepository,
	MongoCurrencyRepository,
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
	MongoMediaZipRepository,
} from '@saha-textile/adapters-db-mongo';
import { YazlZipArchive } from '@saha-textile/adapters-archive-zip';
import { SharpImageAnalysis, SharpImageCodec } from '@saha-textile/adapters-image-sharp';
import { ChromiumDocumentRenderer } from '@saha-textile/adapters-pdf-chromium';
import {
	BullMqMediaJobQueue,
	type MediaJobHandlers,
	startDocumentWorker,
	startMediaWorker,
} from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';
import { YouTubeDataApi } from '@saha-textile/adapters-youtube';
import { ExchangeRateApiFxAdapter } from '@saha-textile/adapters-fx';
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
	buildZip,
	sweepZips,
	measureWordSpots,
} from '@saha-textile/core-domain';

import type { AppConfig } from '../config/app-config';
import { LanguageStore } from '../languages/language-store';
import { LogOnlyCdnPurgeAdapter } from '../infra/log-only-cdn-purge.adapter';
import { buildNotificationPort } from '../infra/notification-factory';
import { MeilisearchSearch, noProductsLoaded } from '../search/meilisearch-search';
import { catchUpSearch, drainSearchQueue, nightlySearchCheck } from '../search/search-release';
import { composePageBuilderJobs } from '../page-builder/page-go-live.worker';
import { fetchRatesIfDue } from '../fx/fx-fetch';
import { warmPage } from '../page-builder/page-warm';

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

	// Folder downloads as .zip (media step 5).
	const zipRecords = new MongoMediaZipRepository();
	const ledger = new MongoStorageLedgerRepository();
	const zipDeps = {
		zips: zipRecords,
		folders: new MongoMediaFolderRepository(),
		browse: assets,
		assets,
		storage,
		archive: new YazlZipArchive(),
		now,
	};

	// Page Builder (step 7): Go Lives waiting for pictures, the nightly check and History upkeep.
	const pageBuilder = composePageBuilderJobs(languages, storage, queue);

	const handlers: MediaJobHandlers = {
		'page-go-live-waiting': async () => {
			const went = await pageBuilder.waiting();
			if (went) logger.log(`Page Builder: ${went} waiting Go Live went live`);
			return { went };
		},
		// The words check (Page Builder SG-1): one version's word spots, measured once.
		'word-spots': async (job) => {
			const outcome = await measureWordSpots(
				{ assets, storage, analysis: new SharpImageAnalysis(), spots: assets },
				{ assetId: job.assetId, versionId: job.versionId },
			);
			return { outcome };
		},
		// FX-8: just after a switch, the shop is asked for the page in each shop language.
		'page-warm': async (job) => {
			const result = await warmPage(
				{ origin: config.media.shopOrigin ?? null, locales: languages.shop(), fetch },
				job.pageType,
			);
			logger.log(
				`Page Builder warm ${job.pageType} (${job.at}): ${result.skipped ?? result.statuses.join(', ')}`,
			);
			return result;
		},
		'fx-fetch-due': async () => {
			const result = await fetchRatesIfDue({
				settings,
				currencies: new MongoCurrencyRepository(),
				fx: new ExchangeRateApiFxAdapter({ apiKey: config.fx.exchangeRateApiKey ?? null }),
			});
			if (result && !result.ok)
				logger.warn(`Exchange rates: the daily fetch failed (${result.problem ?? 'no reason'})`);
			else if (result) logger.log(`Exchange rates: updated ${result.updated.join(', ') || 'nothing'}`);
			return result;
		},
		'page-builder-nightly': async () => {
			const result = await pageBuilder.nightly();
			logger.log(
				`Page Builder nightly: ${result.withProblems} layouts to fix, ${result.pruned} old revisions removed`,
			);
			return result;
		},
		process: (job) => processMediaAsset(processDeps, { assetId: job.assetId, reprocess: false }),
		reprocess: (job) => processMediaAsset(processDeps, { assetId: job.assetId, reprocess: true }),
		replace: (job) => replaceMediaAsset(processDeps, { assetId: job.assetId }),
		// A folder download (media step 5, A30): the .zip is written into Spaces file by file.
		zip: async (job) => {
			const outcome = await buildZip(zipDeps, { zipId: job.zipId });
			logger.log(`.zip ${job.zipId}: ${outcome}`);
		},
		// Every hour: .zip files past their 24 hours, and cancelled or failed ones, are deleted and stop counting.
		'zip-sweep': async () => {
			const swept = await sweepZips({
				zips: zipRecords,
				storage,
				releaseHold: (id) => ledger.release(id),
				now,
			});
			if (swept) logger.log(`.zip sweep: ${swept} deleted`);
		},
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

	// Business documents (owner decision 2026-11-17): one browser, opened on the first PDF and
	// closed after a minute without work, two documents at a time.
	const documents = new ChromiumDocumentRenderer({
		channel: config.documents.chromiumChannel,
		executablePath: config.documents.chromiumExecutable,
		noSandbox: config.documents.noSandbox,
		timeoutMs: config.documents.renderTimeoutMs,
		idleCloseMs: 60_000,
		concurrency: 2,
	});
	const documentWorker = startDocumentWorker(config.redis, documents, 2);
	documentWorker.on('failed', (job, error) => logger.warn(`Document ${job?.id ?? ''} failed: ${error.message}`));

	return {
		async close() {
			languages.onModuleDestroy();
			await worker.close();
			await documentWorker.close();
			await documents.close();
			await queue.close();
		},
	};
};

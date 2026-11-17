import {
	MongoAdminUserRepository,
	MongoAdminUserRoleAssignmentRepository,
	MongoAuditLogRepository,
	MongoBlogPostRepository,
	MongoCategoryPlacementRepository,
	MongoContentBlockRepository,
	MongoMediaAssetRepository,
	MongoPageLayoutRepository,
	MongoProductRepository,
	MongoRoleRepository,
	MongoSavedBlockRepository,
	MongoSiteSettingsRepository,
} from '@saha-textile/adapters-db-mongo';
import { LAYOUT_HISTORY } from '@saha-textile/contracts';
import { type MediaJobQueuePort, type StoragePort, registeredPageTypes } from '@saha-textile/core-domain';

import type { LanguageStore } from '../languages/language-store';
import { PageBuilderService } from './page-builder.service';
import { PageGoLiveService } from './page-go-live.service';

/**
 * The Page Builder's background work, for the worker process (which composes its adapters by hand, without Nest):
 * Go Lives waiting for pictures (E5, every minute), and at night the checks again (SG-12) and History kept to its
 * limits (Q12).
 */
export function composePageBuilderJobs(
	languages: LanguageStore,
	storage: Pick<StoragePort, 'getUrl'>,
	queue: Pick<MediaJobQueuePort, 'enqueue'> | null = null,
) {
	const layouts = new MongoPageLayoutRepository();
	const settings = new MongoSiteSettingsRepository();
	const builder = new PageBuilderService(
		layouts,
		languages,
		new MongoAdminUserRepository(),
		new MongoMediaAssetRepository(),
		storage,
		settings,
		new MongoContentBlockRepository(),
		new MongoAuditLogRepository(),
		queue,
	);
	const goLive = new PageGoLiveService(
		layouts,
		new MongoSavedBlockRepository(),
		builder,
		languages,
		settings,
		new MongoProductRepository(),
		new MongoBlogPostRepository(),
		new MongoRoleRepository(),
		new MongoAdminUserRoleAssignmentRepository(),
		new MongoCategoryPlacementRepository(),
	);
	return {
		waiting: (now = new Date()) => goLive.settleWaiting(now),
		nightly: async (now = new Date()) => {
			const withProblems = await goLive.nightlyCheck(now);
			const draftsAfter = new Date(now.getTime() - LAYOUT_HISTORY.draftDays * 86_400_000).toISOString();
			const pruned = await layouts.prune({ keepGoLive: LAYOUT_HISTORY.goLiveRevisions, draftsAfter });
			// FX-8: the next day's switches are queued again, in case the queue lost one.
			let warms = 0;
			for (const rules of registeredPageTypes()) warms += await builder.warmSwitches(rules.key, now);
			return { withProblems, pruned, warms };
		},
	};
}

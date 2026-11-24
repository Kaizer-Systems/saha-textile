import { describe, expect, it, vi } from 'vitest';

/** The worker composes its own adapters; here each one is a stand-in, so nothing reaches a database. */
const calls = vi.hoisted(() => ({ settled: [] as Date[], checked: [] as Date[] }));
vi.mock('@saha-textile/adapters-db-mongo', async () => {
	const bare = class {};
	return {
		MongoAdminUserRepository: bare,
		MongoAdminUserRoleAssignmentRepository: bare,
		MongoAuditLogRepository: bare,
		MongoBlogPostRepository: bare,
		MongoCategoryPlacementRepository: bare,
		MongoContentBlockRepository: bare,
		MongoMediaAssetRepository: bare,
		MongoPageLayoutRepository: class {
			prune = vi.fn(async () => 4);
		},
		MongoProductRepository: bare,
		MongoRoleRepository: bare,
		MongoSavedBlockRepository: bare,
		MongoSiteSettingsRepository: bare,
	};
});
vi.mock('../src/page-builder/page-go-live.service', () => ({
	PageGoLiveService: class {
		settleWaiting = async (now: Date) => (calls.settled.push(now), 2);
		nightlyCheck = async (now: Date) => (calls.checked.push(now), 1);
	},
}));

import { LanguageStore } from '../src/languages/language-store';
import { composePageBuilderJobs } from '../src/page-builder/page-go-live.worker';

describe('the Page Builder’s background jobs', () => {
	it('settles waiting Go Lives and runs the nightly check at the time now when none is given', async () => {
		const jobs = composePageBuilderJobs(LanguageStore.fixed(['en', 'bn']), { getUrl: (key: string) => key });
		expect(await jobs.waiting()).toBe(2);
		expect(await jobs.nightly()).toEqual({ withProblems: 1, pruned: 4, warms: 0 });
		expect(calls.settled[0]).toBeInstanceOf(Date);
		expect(calls.checked[0]).toBeInstanceOf(Date);
	});
});

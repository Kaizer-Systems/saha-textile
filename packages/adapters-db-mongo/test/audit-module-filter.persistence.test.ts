import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMongo, disconnectMongo } from '../src/connection';
import { AuditLogModel } from '../src/models/index';
import { MongoAuditLogRepository } from '../src/repositories/governance.repository';

import { hasMongoEnv } from './mongo-test-env';

/**
 * Brief 26 AU1: the audit trail reviewed by module, the action's first part:
 *   node scripts/secrets/test-login.mjs run saha_textile_test -- pnpm --filter @saha-textile/adapters-db-mongo exec vitest run test/audit-module-filter.persistence.test.ts
 */
describe.skipIf(!hasMongoEnv())('audit trail by module (integration, rs0)', () => {
	// A module name of letters only, this run's own.
	const mod = `aum${Math.random()
		.toString(36)
		.replace(/[^a-z]/g, '')
		.slice(0, 8)}`;
	const repo = new MongoAuditLogRepository();
	const entry = (id: string, action: string) => ({
		id: `aud_${mod}_${id}`,
		actorUserId: 'adm_test',
		targetUserId: null,
		audience: 'admin' as const,
		action,
		entityType: 'employee',
		entityId: 'emp_1',
		severity: 'info' as const,
		retentionTier: 'financial_security' as const,
		diffs: [],
		metadata: {},
		requestId: null,
		ipHash: null,
		userAgentHash: null,
		createdAt: '2098-01-01T00:00:00.000Z',
	});

	beforeAll(async () => {
		await connectMongo();
		await repo.append(entry('a', `${mod}.payslip.edit`));
		await repo.append(entry('b', `${mod}.salary.revise`));
		await repo.append(entry('c', `${mod}x.other`));
	});
	afterAll(async () => {
		await AuditLogModel.deleteMany({ action: { $regex: `^${mod}` } }).exec();
		await disconnectMongo();
	});

	it('lists a module’s actions only, and an exact action over the module', async () => {
		const page = await repo.list({ module: mod, page: 1, pageSize: 50 });
		expect(page.items.map((i) => i.action).sort()).toEqual([`${mod}.payslip.edit`, `${mod}.salary.revise`]);
		const exact = await repo.list({ module: mod, action: `${mod}x.other`, page: 1, pageSize: 50 });
		expect(exact.items.map((i) => i.action)).toEqual([`${mod}x.other`]);
	});
});

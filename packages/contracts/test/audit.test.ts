import { describe, expect, it } from 'vitest';

import { AuditLog, AuditLogEntry, AuditLogListQuery, toAuditLogEntry } from '../src/index';

/**
 * The audit read model.
 *
 * The property under test is a subtraction rather than an addition: what the trail publishes
 * must be strictly less than what it stores. Everything else here guards the page bound, which
 * is the difference between a filterable read and an export of the whole security history.
 */

const stored = AuditLog.parse({
	id: 'audit_1',
	actorUserId: 'user_actor',
	targetUserId: 'user_target',
	audience: 'admin',
	action: 'admin.security.password.change',
	entityType: 'user',
	entityId: 'user_target',
	severity: 'warn',
	retentionTier: 'financial_security',
	diffs: [{ field: 'revokedSessions', after: 2 }],
	metadata: { note: 'safe context' },
	requestId: 'req_1',
	ipHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	userAgentHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
	createdAt: new Date().toISOString(),
});

describe('AuditLogEntry', () => {
	/**
	 * An IP hash is not a one-way function in any useful sense: IPv4 has under 2^32 values, so
	 * an unsalted digest is reversible by exhaustive search in seconds. Publishing it would be
	 * publishing the address, which is what storing a hash instead of the address was meant to
	 * avoid.
	 */
	it('drops both hashes, and the projection is the only way in', () => {
		const entry = toAuditLogEntry(stored);

		expect(entry).not.toHaveProperty('ipHash');
		expect(entry).not.toHaveProperty('userAgentHash');
		expect(JSON.stringify(entry)).not.toContain(stored.ipHash);
		expect(JSON.stringify(entry)).not.toContain(stored.userAgentHash);
	});

	// A schema that merely tolerated the hashes would let a careless caller pass the entity
	// through unprojected and publish them.
	it('strips a hash that is handed to it anyway', () => {
		const parsed = AuditLogEntry.parse(stored);

		expect(parsed).not.toHaveProperty('ipHash');
		expect(parsed).not.toHaveProperty('userAgentHash');
	});

	it('keeps everything an investigator actually needs', () => {
		const entry = toAuditLogEntry(stored);

		expect(entry).toMatchObject({
			id: 'audit_1',
			actorUserId: 'user_actor',
			targetUserId: 'user_target',
			action: 'admin.security.password.change',
			severity: 'warn',
			retentionTier: 'financial_security',
			requestId: 'req_1',
		});
		expect(entry.diffs).toEqual([{ field: 'revokedSessions', after: 2 }]);
	});
});

describe('AuditLogListQuery', () => {
	// It validates a QUERY STRING, where every value arrives as text. Without coercion
	// `?page=2` fails as "expected number, received string" and the endpoint is unusable.
	it('coerces the paging values a URL actually carries', () => {
		const parsed = AuditLogListQuery.parse({ page: '3', pageSize: '25' });

		expect(parsed.page).toBe(3);
		expect(parsed.pageSize).toBe(25);
	});

	it('defaults to the first page at fifty', () => {
		expect(AuditLogListQuery.parse({})).toMatchObject({ page: 1, pageSize: 50 });
	});

	// The bound is what stops this being an export of the entire security trail. Coercion must
	// not have loosened it.
	it('refuses a page larger than the cap, however it is expressed', () => {
		expect(AuditLogListQuery.safeParse({ pageSize: 201 }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ pageSize: '201' }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ pageSize: '99999' }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ pageSize: 200 }).success).toBe(true);
	});

	it('refuses a nonsensical page', () => {
		expect(AuditLogListQuery.safeParse({ page: 0 }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ page: -1 }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ page: '1.5' }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ page: 'first' }).success).toBe(false);
	});

	it('rejects a filter value that is not a declared enum member', () => {
		expect(AuditLogListQuery.safeParse({ severity: 'catastrophic' }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ audience: 'partner' }).success).toBe(false);
		expect(AuditLogListQuery.safeParse({ severity: 'critical', audience: 'admin' }).success).toBe(true);
	});
});

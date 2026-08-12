import { z } from 'zod';

import { Id, IsoDateTime } from './common';

/**
 * Audit retention tier (owner lock 2026-07-23): `financial_security` = 7 years,
 * `catalog_admin` = 5 years. Raw analytics events are NOT audit logs (~90 days
 * after rollup; see `analytics` contracts when built).
 */
export const AuditRetentionTier = z.enum(['financial_security', 'catalog_admin']);
export type AuditRetentionTier = z.infer<typeof AuditRetentionTier>;

export const AuditAudience = z.enum(['storefront', 'admin', 'system']);
export type AuditAudience = z.infer<typeof AuditAudience>;

export const AuditSeverity = z.enum(['info', 'warn', 'critical']);
export type AuditSeverity = z.infer<typeof AuditSeverity>;

/**
 * Field-level diff (owner lock 2026-07-23: prefer diffs over huge before/after
 * documents; secrets/tokens/PAN are NEVER persisted — redact before writing).
 */
export const AuditFieldDiff = z.object({
	field: z.string().min(1),
	before: z.unknown().optional(),
	after: z.unknown().optional(),
});
export type AuditFieldDiff = z.infer<typeof AuditFieldDiff>;

/**
 * Broad admin/security audit entity (`auditLogs` collection). Owner lock
 * 2026-07-23: EVERY admin mutating write creates a row (catalog, pricing,
 * stock, purchase invoices, order/payment/refund state, config, roles, auth
 * events). Append-only at application level; hashes only for IP/UA.
 */
export const AuditLog = z.object({
	id: Id,
	/** Null for system/anonymous events (e.g. failed login for unknown identifier). */
	actorUserId: Id.nullable().default(null),
	targetUserId: Id.nullable().default(null),
	audience: AuditAudience,
	/** Dot-namespaced action, e.g. `product.status.change`, `auth.login_failure`, `notification.channel.toggle`. */
	action: z.string().min(1),
	entityType: z.string().min(1).nullable().default(null),
	entityId: Id.nullable().default(null),
	severity: AuditSeverity.default('info'),
	retentionTier: AuditRetentionTier.default('catalog_admin'),
	diffs: z.array(AuditFieldDiff).default([]),
	/** Redacted, non-secret context only. */
	metadata: z.record(z.string(), z.unknown()).default({}),
	requestId: z.string().nullable().default(null),
	ipHash: z.string().nullable().default(null),
	userAgentHash: z.string().nullable().default(null),
	createdAt: IsoDateTime,
});
export type AuditLog = z.infer<typeof AuditLog>;

/**
 * `GET /admin/audit-logs` list filter (high-privilege RBAC; server-authorized).
 *
 * `page` and `pageSize` are `coerce`d because this schema validates a QUERY STRING, where
 * every value arrives as text: without it `?page=2` fails as "expected number, received
 * string" and the endpoint is unusable from a browser. Coercion does not loosen the bound —
 * `pageSize` is still capped at 200, which is what keeps this from becoming an unbounded
 * export of the security trail.
 */
export const AuditLogListQuery = z.object({
	actorUserId: Id.optional(),
	targetUserId: Id.optional(),
	action: z.string().optional(),
	entityType: z.string().optional(),
	entityId: Id.optional(),
	severity: AuditSeverity.optional(),
	audience: AuditAudience.optional(),
	from: IsoDateTime.optional(),
	to: IsoDateTime.optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(200).default(50),
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuery>;

/**
 * What `GET /admin/audit-logs` returns — the entity MINUS its two hashes.
 *
 * `ipHash` and `userAgentHash` are omitted deliberately, and not merely for tidiness. The
 * build prompt's contract rule is that internal schemas may carry hashes and public ones never
 * can, and an IP hash is the case that shows why: IPv4 has fewer than 2^32 values, so an
 * unsalted digest of an address is not a one-way function in any meaningful sense — it is
 * reversible by exhaustive search in seconds on a laptop. Publishing it to a screen would be
 * publishing the address, which is exactly what storing a hash instead of the address was
 * meant to avoid.
 *
 * If correlating "the same actor from the same origin" is ever needed on this surface, the
 * answer is a per-investigation derived token, not this field.
 *
 * Everything else is safe by construction rather than by filtering here: `diffs` and
 * `metadata` are redacted before they are ever written (owner lock 2026-07-23 — secrets,
 * tokens and PAN are never persisted), so the read model does not re-litigate that.
 */
export const AuditLogEntry = AuditLog.omit({ ipHash: true, userAgentHash: true });
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

/** `GET /admin/audit-logs` response. */
export const AuditLogListResponse = z.object({
	items: z.array(AuditLogEntry),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	pageSize: z.number().int().positive(),
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponse>;

/**
 * Projects a stored entry onto the read model.
 *
 * Declared beside the schema, so the two hashes are dropped in the one place the omission is
 * explained. A controller doing this inline is a controller where the next field added to
 * `AuditLog` silently becomes public.
 */
export function toAuditLogEntry(entry: AuditLog): AuditLogEntry {
	const { ipHash: _ipHash, userAgentHash: _userAgentHash, ...safe } = entry;
	return safe;
}

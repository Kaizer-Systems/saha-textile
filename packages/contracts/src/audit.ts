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

/** `GET /admin/audit-logs` list filter (high-privilege RBAC; server-authorized). */
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
	page: z.number().int().positive().default(1),
	pageSize: z.number().int().positive().max(200).default(50),
});
export type AuditLogListQuery = z.infer<typeof AuditLogListQuery>;

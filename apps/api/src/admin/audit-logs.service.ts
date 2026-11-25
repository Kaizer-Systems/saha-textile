import { Inject, Injectable, Optional } from '@nestjs/common';
import { type AuditLogListQuery, type AuditLogListResponse, toAuditLogEntry } from '@saha-textile/contracts';
import type { AdminUserRepository, AuditLogRepository } from '@saha-textile/core-domain';

import { ADMIN_USER_REPOSITORY, AUDIT_LOG_REPOSITORY } from '../infra/tokens';

/** How the admin names a person: display name, else username, else email, else the id. */
const nameOf = (u: { id: string; displayName?: string; username: string | null; email: string | null }) =>
	u.displayName || u.username || u.email || u.id;

/**
 * Reading the audit trail.
 *
 * Every admin mutation this system performs has been writing rows under a seven-year retention
 * tier since the first RBAC pass, and until now nothing could read them — the trail was
 * write-only, which meant the question it exists to answer ("who changed this, and when?") had
 * no answer that did not involve a database shell.
 *
 * Deliberately read-only, and it will stay that way. There is no update and no delete here:
 * `purgeOlderThan` on the repository belongs to the retention job, which runs by tier and by
 * age, not by anybody's request. An HTTP route that could remove an audit row would defeat the
 * only property that makes the trail worth keeping.
 */
@Injectable()
export class AuditLogsService {
	constructor(
		@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
		// Brief 26 AU1: names for the people in the trail (optional, so an older composition still starts).
		@Optional()
		@Inject(ADMIN_USER_REPOSITORY)
		private readonly admins: Pick<AdminUserRepository, 'findById' | 'list'> | null = null,
	) {}

	/** Brief 26 AU1: everyone who can appear in the trail, by name, for the Who picker. */
	async people(): Promise<{ id: string; name: string }[]> {
		if (!this.admins) return [];
		const out: { id: string; name: string }[] = [];
		for (let page = 1; page <= 50; page++) {
			const found = await this.admins.list({ page, pageSize: 200 });
			out.push(...found.items.map((u) => ({ id: u.id, name: nameOf(u) })));
			if (page * 200 >= found.meta.total) break;
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Lists entries newest first, projected onto the read model.
	 *
	 * The filter and the page bounds are the contract's, so an unbounded read is not
	 * expressible: `pageSize` is capped at 200 by the schema, and a caller asking for more is
	 * refused rather than quietly served a truncated page that looks complete.
	 */
	async list(query: AuditLogListQuery): Promise<AuditLogListResponse> {
		const page = await this.audit.list(query);
		// Brief 26 AU1: each person named once per page.
		const ids = [...new Set(page.items.map((e) => e.actorUserId).filter((id): id is string => !!id))];
		const names = new Map<string, string>();
		for (const id of this.admins ? ids : []) {
			const u = await this.admins?.findById(id);
			if (u) names.set(id, nameOf(u));
		}
		return {
			items: page.items.map((e) => ({
				...toAuditLogEntry(e),
				actorName: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
			})),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		};
	}
}

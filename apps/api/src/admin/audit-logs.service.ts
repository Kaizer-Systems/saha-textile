import { Inject, Injectable } from '@nestjs/common';
import { type AuditLogListQuery, type AuditLogListResponse, toAuditLogEntry } from '@saha-textile/contracts';
import type { AuditLogRepository } from '@saha-textile/core-domain';

import { AUDIT_LOG_REPOSITORY } from '../infra/tokens';

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
	constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository) {}

	/**
	 * Lists entries newest first, projected onto the read model.
	 *
	 * The filter and the page bounds are the contract's, so an unbounded read is not
	 * expressible: `pageSize` is capped at 200 by the schema, and a caller asking for more is
	 * refused rather than quietly served a truncated page that looks complete.
	 */
	async list(query: AuditLogListQuery): Promise<AuditLogListResponse> {
		const page = await this.audit.list(query);

		return {
			items: page.items.map(toAuditLogEntry),
			total: page.total,
			page: page.page,
			pageSize: page.pageSize,
		};
	}
}

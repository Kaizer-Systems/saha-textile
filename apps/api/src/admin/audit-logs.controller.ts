import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogListQuery, type AuditLogListResponse } from '@saha-textile/contracts';

import { Audience, RequirePermissions } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { API_TAGS } from '../openapi-tags';
import { AuditLogsService } from './audit-logs.service';

/**
 * The audit trail, readable at last.
 *
 * ## Why `audit.index` is its own permission
 *
 * It would have been less work to gate this on `user.index` or `setting.index`, and it would
 * have been wrong. This trail records what every OTHER operator did — role grants, credential
 * changes, offboardings, refusals. Being able to administer a resource must not imply being
 * able to read the history of everyone who has touched it, because the two answer different
 * questions: one is "may you act here", the other is "may you watch your colleagues". They are
 * separated for the same reason `user_role.assign` and `user_role.revoke` are.
 *
 * ## Read-only, permanently
 *
 * There is no write, update or delete route here and there should never be one. Rows are
 * appended in the same transaction as the mutation they describe, and removed only by the
 * retention job, by tier and by age. An HTTP route that could edit or delete an audit row
 * would remove the only property that makes the trail evidence rather than a log file.
 *
 * The query is validated by the contract rather than read parameter by parameter, which is
 * what enforces the 200-row page cap: there is no way to phrase an unbounded export of the
 * security trail through this endpoint.
 */
@ApiTags(API_TAGS.auth)
@Audience('admin')
@Controller('admin/audit-logs')
export class AuditLogsController {
	constructor(private readonly auditLogs: AuditLogsService) {}

	@Get()
	@RequirePermissions('audit.index')
	@ApiOperation({
		operationId: 'listAuditLogs',
		summary: 'Read the admin audit trail (newest first, filterable, bounded page size)',
	})
	list(@Query(new ZodValidationPipe(AuditLogListQuery)) query: AuditLogListQuery): Promise<AuditLogListResponse> {
		return this.auditLogs.list(query);
	}
}

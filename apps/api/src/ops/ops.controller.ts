import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OpsMessagesQuery, type OpsJobs, type OpsMessages } from '@saha-textile/contracts';
import type { z } from 'zod';

import { OpsTokenGuard } from './ops-token.guard';
import { OpsService } from './ops.service';
import { Public } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * The operations address the Release Console reads (brief 26gq3NbcbBESea6abRtsa3, Q1 A): read only,
 * its own key instead of a session, and nothing personal. Off unless `OPS_TOKEN` is set.
 */
@Public()
@UseGuards(OpsTokenGuard)
@Controller('ops')
export class OpsController {
	constructor(private readonly ops: OpsService) {}

	@Get('jobs')
	jobs(): Promise<OpsJobs> {
		return this.ops.jobs();
	}

	@Get('messages')
	messages(
		@Query(new ZodValidationPipe(OpsMessagesQuery)) query: z.infer<typeof OpsMessagesQuery>,
	): Promise<OpsMessages> {
		return this.ops.messages(query.hours);
	}
}

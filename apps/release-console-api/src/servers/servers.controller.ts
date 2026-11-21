import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
	type DropletJob,
	startDropletCreateSchema,
	startDropletDestroySchema,
} from '@saha-textile/release-console-contracts';

import { DropletJobs } from './droplet-jobs.js';
import { parseBody } from '../common/parse.js';
import { LockService } from '../lock/lock.service.js';
import { sessionOf } from '../lock/session.guard.js';

type Req = Parameters<typeof sessionOf>[0];

/**
 * DigitalOcean › Droplets: create a server step by step, or destroy a staging or development one,
 * each after the PIN and the typed name (brief v7). The screen follows a job by its id.
 */
@Controller('api/projects/:p/repos/:r/cloud/:slot/droplet-jobs')
export class ServersController {
	constructor(
		private readonly jobs: DropletJobs,
		private readonly lock: LockService,
	) {}

	@Get()
	list(@Param('p') p: string, @Param('r') r: string): DropletJob[] {
		return this.jobs.list(p, r);
	}

	@Get(':id')
	one(@Param('id') id: string): DropletJob {
		return this.jobs.get(id);
	}

	@Post('create')
	@HttpCode(202)
	async create(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Promise<DropletJob> {
		const input = parseBody(startDropletCreateSchema, body);
		this.lock.confirm(sessionOf(req), input.pin, `create the ${input.draft.environment} server`);
		return this.jobs.startCreate(p, r, slot, input);
	}

	@Post('destroy')
	@HttpCode(202)
	async destroy(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Promise<DropletJob> {
		const input = parseBody(startDropletDestroySchema, body);
		this.lock.confirm(sessionOf(req), input.pin, `destroy ${input.confirm}`);
		return this.jobs.startDestroy(p, r, slot, input);
	}
}

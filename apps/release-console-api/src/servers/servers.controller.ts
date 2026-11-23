import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
	type DeployToken,
	type DropletJob,
	type EnvTags,
	setEnvTagSchema,
	setSshEmailsSchema,
	startDropletCreateSchema,
	startDropletDestroySchema,
	startServerFixSchema,
} from '@saha-textile/release-console-contracts';

import { DropletJobs } from './droplet-jobs.js';
import { ProjectsService } from '../projects/projects.service.js';
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

	/** Each server's deploy token and its end date (Release Path brief C6). */
	@Get('tokens')
	tokens(@Param('p') p: string): Promise<DeployToken[]> {
		return this.jobs.deployTokens(p);
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

	/** Finish setup or Renew token for a server that exists (Release Path brief C5, C6), after the PIN. */
	@Post('fix')
	@HttpCode(202)
	async fix(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Promise<DropletJob> {
		const input = parseBody(startServerFixSchema, body);
		this.lock.confirm(
			sessionOf(req),
			input.pin,
			`${input.kind === 'finish' ? 'finish setting up' : 'renew the deploy token of'} ${input.environment}`,
		);
		return this.jobs.startFix(p, r, slot, input);
	}
}

/** The project's SSH list (owner, 21 Nov); every server's Access rule follows, after the PIN. */
@Controller('api/projects/:p/ssh-emails')
export class SshListController {
	constructor(
		private readonly jobs: DropletJobs,
		private readonly lock: LockService,
		private readonly projects: ProjectsService,
	) {}

	@Put()
	async set(
		@Param('p') p: string,
		@Body() body: unknown,
		@Req() req: Req,
	): Promise<{ emails: string[]; hosts: string[] }> {
		const input = parseBody(setSshEmailsSchema, body);
		this.lock.confirm(sessionOf(req), input.pin, 'change who may sign in over SSH');
		const project = this.projects.setSshEmails(p, input.emails);
		return { emails: project.sshEmails, hosts: await this.jobs.updateSshList(p) };
	}
}

/**
 * Which environment each cloud resource belongs to (owner, 23 Nov): read by every list that labels
 * resources, set from the pop-up after a server is created or from Tag environment, after the PIN.
 */
@Controller('api/projects/:p/repos/:r/env-tags')
export class EnvTagsController {
	constructor(
		private readonly lock: LockService,
		private readonly projects: ProjectsService,
	) {}

	@Get()
	list(@Param('p') p: string, @Param('r') r: string): EnvTags {
		return this.projects.envTags(p, r);
	}

	@Put()
	set(@Param('p') p: string, @Param('r') r: string, @Body() body: unknown, @Req() req: Req): EnvTags {
		const input = parseBody(setEnvTagSchema, body);
		this.lock.confirm(sessionOf(req), input.pin, `tag ${input.key} with an environment`);
		return this.projects.setEnvTag(p, r, input.key, input.env);
	}
}

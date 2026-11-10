import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
	type AttentionCount,
	type AttentionItem,
	type AuditEntry,
	type CloudAccount,
	type ConsoleView,
	type DnsRecord,
	type Droplet,
	type EdgeZone,
	type KeyRef,
	newProjectSchema,
	type Project,
	type PullRequest,
	slotKeysSchema,
	storeKeySchema,
	type VendorAnswer,
	type WorkflowRun,
} from '@saha-textile/release-console-contracts';

import { AttentionService } from './attention.service.js';
import { ProjectsService } from './projects.service.js';
import { VendorReadsService } from './vendor-reads.service.js';
import { parseBody } from '../common/parse.js';
import { ConsoleStore } from '../store/console-store.js';

@Controller('api')
export class ProjectsController {
	constructor(
		private readonly projects: ProjectsService,
		private readonly reads: VendorReadsService,
		private readonly attention: AttentionService,
		private readonly store: ConsoleStore,
	) {}

	@Get('projects')
	view(): ConsoleView {
		return this.projects.view();
	}

	@Post('projects')
	add(@Body() body: unknown): Project {
		return this.projects.add(parseBody(newProjectSchema, body));
	}

	@Delete('projects/:id')
	@HttpCode(200)
	async remove(@Param('id') id: string): Promise<{ ok: true }> {
		await this.projects.remove(id);
		this.attention.forget(id);
		return { ok: true };
	}

	@Post('projects/:id/keys')
	async storeKey(@Param('id') id: string, @Body() body: unknown): Promise<KeyRef> {
		const ref = await this.projects.storeKey(id, parseBody(storeKeySchema, body));
		this.attention.forget(id);
		return ref;
	}

	@Post('projects/:id/keys/:keyId/check')
	@HttpCode(200)
	async checkKey(@Param('id') id: string, @Param('keyId') keyId: string): Promise<KeyRef> {
		const ref = await this.projects.checkKeyNow(id, keyId);
		this.attention.forget(id);
		return ref;
	}

	@Delete('projects/:id/keys/:keyId')
	@HttpCode(200)
	async removeKey(@Param('id') id: string, @Param('keyId') keyId: string): Promise<{ ok: true }> {
		await this.projects.removeKey(id, keyId);
		this.attention.forget(id);
		return { ok: true };
	}

	@Put('projects/:id/slots')
	slots(@Param('id') id: string, @Body() body: unknown): Project {
		const project = this.projects.setSlotKeys(id, parseBody(slotKeysSchema, body));
		this.attention.forget(id);
		return project;
	}

	@Get('attention')
	counts(): Promise<AttentionCount[]> {
		return this.attention.counts();
	}

	@Get('projects/:id/attention')
	projectAttention(@Param('id') id: string): Promise<AttentionItem[]> {
		return this.attention.forProject(id);
	}

	@Get('audit')
	audit(@Query('project') project?: string): AuditEntry[] {
		if (project) this.projects.project(project);
		return this.store.auditEntries(project ?? null).slice(0, 500);
	}

	@Get('projects/:p/repos/:r/github/pulls')
	pulls(@Param('p') p: string, @Param('r') r: string): Promise<VendorAnswer<PullRequest[]>> {
		return this.reads.pulls(p, r);
	}

	@Get('projects/:p/repos/:r/github/runs')
	runs(@Param('p') p: string, @Param('r') r: string): Promise<VendorAnswer<WorkflowRun[]>> {
		return this.reads.runs(p, r);
	}

	@Get('projects/:p/repos/:r/cloud/:slot/droplets')
	droplets(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
	): Promise<VendorAnswer<Droplet[]>> {
		return this.reads.droplets(p, r, slot);
	}

	@Get('projects/:p/repos/:r/cloud/:slot/account')
	cloudAccount(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
	): Promise<VendorAnswer<CloudAccount>> {
		return this.reads.cloudAccount(p, r, slot);
	}

	@Get('projects/:p/repos/:r/edge/:slot/zones')
	zones(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
	): Promise<VendorAnswer<EdgeZone[]>> {
		return this.reads.zones(p, r, slot);
	}

	@Get('projects/:p/repos/:r/edge/:slot/zones/:zone/dns')
	dns(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('slot') slot: string,
		@Param('zone') zone: string,
	): Promise<VendorAnswer<DnsRecord[]>> {
		return this.reads.records(p, r, slot, zone);
	}
}

import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
	type ServerDeployView,
	type ServerTarget,
	type VendorAnswer,
	reviewServerDeploySchema,
	serverTargetOf,
	startServerDeploySchema,
} from '@saha-textile/release-console-contracts';

import { ProjectsService } from './projects.service.js';
import { parseBody } from '../common/parse.js';
import { LockService } from '../lock/lock.service.js';
import { sessionOf } from '../lock/session.guard.js';
import { HelperError } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';
import { reviewServerDeploy, serverDeployView, startServerDeploy } from '../vendors/github-deploys.js';
import { VendorError } from '../vendors/http.js';

type Req = Parameters<typeof sessionOf>[0];

/** Why an environment's server deploy cannot be read or started, in words the screen shows. */
class NotReady extends Error {}

/**
 * Ship › Live deploy for an environment that runs on a server (owner, 20 Nov): the console starts
 * GitHub's deploy.yml with the PIN, follows its jobs and steps, and approves or rejects the deploy
 * job's wait on its GitHub environment with the PIN. Environments on this computer run the local
 * pipeline instead (LocalController).
 */
@Controller('api/projects/:p/repos/:r/server-deploy/:env')
export class ServerDeployController {
	constructor(
		private readonly projects: ProjectsService,
		private readonly lock: LockService,
		private readonly store: ConsoleStore,
	) {}

	private async context(p: string, r: string, env: string) {
		const { project, repo } = this.projects.repository(p, r);
		const e = repo.environments.find((x) => x.name === env);
		if (!e) throw new NotReady(`${repo.name} has no environment ${env}.`);
		if (e.cloudId === null) throw new NotReady(`${e.label} runs on this computer, so it runs the local pipeline.`);
		if (repo.sourceCode.vendor !== 'github')
			throw new NotReady(
				'Server deploys run through GitHub Actions today; this repository is on another vendor.',
			);
		const target: ServerTarget | null = serverTargetOf(e.name);
		if (!target)
			throw new NotReady(
				`${e.label} runs on a server without a deploy target yet. A development server needs its own Infisical deploy identity, a "development" GitHub environment and the API's own deploy setting first.`,
			);
		const ref = project.keys.find((k) => k.id === repo.sourceCode.keyId);
		const key = ref ? await this.projects.valueOf(ref) : null;
		if (!key)
			throw new NotReady('GitHub is not connected for this repository. Add its key on the Connections screen.');
		return { project, repo, env: e, target, key };
	}

	@Get()
	async view(
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') env: string,
	): Promise<VendorAnswer<ServerDeployView>> {
		try {
			const c = await this.context(p, r, env);
			return {
				state: 'ok',
				readAt: new Date().toISOString(),
				data: await serverDeployView(c.repo.sourceCode.repository, c.env.name, c.target, c.key),
			};
		} catch (err) {
			if (err instanceof NotReady) return { state: 'not-connected', message: err.message };
			if (err instanceof VendorError) return { state: 'error', message: err.message };
			throw err;
		}
	}

	/** Starts deploy.yml for this environment after the PIN; the deploy job then waits for approval. */
	@Post()
	@HttpCode(202)
	async start(
		@Req() req: Req,
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') env: string,
		@Body() body: unknown,
	): Promise<{ ok: true }> {
		const { pin } = parseBody(startServerDeploySchema, body);
		const c = await this.ready(p, r, env);
		this.lock.confirm(sessionOf(req), pin, `deploy ${c.env.name}`);
		await this.vendor(() => startServerDeploy(c.repo.sourceCode.repository, c.target, c.key));
		this.store.audit(
			c.project.id,
			'server-deploy-started',
			`${c.repo.name} · ${c.env.label} → GitHub environment ${c.target}`,
		);
		return { ok: true };
	}

	/** Approves or rejects the deploy job waiting on this environment, after the PIN. */
	@Post('review')
	@HttpCode(200)
	async review(
		@Req() req: Req,
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') env: string,
		@Body() body: unknown,
	): Promise<{ ok: true }> {
		const { pin, runId, approve } = parseBody(reviewServerDeploySchema, body);
		const c = await this.ready(p, r, env);
		this.lock.confirm(sessionOf(req), pin, `${approve ? 'approve' : 'reject'} the ${c.env.name} deploy`);
		const view = await this.vendor(() =>
			serverDeployView(c.repo.sourceCode.repository, c.env.name, c.target, c.key),
		);
		if (view.run?.id !== runId || !view.run.waiting.length)
			throw new HelperError('That run is not waiting for an approval any more.', 409);
		await this.vendor(() =>
			reviewServerDeploy(c.repo.sourceCode.repository, runId, view.run?.waiting ?? [], approve, c.key),
		);
		this.store.audit(
			c.project.id,
			approve ? 'server-deploy-approved' : 'server-deploy-rejected',
			`${c.repo.name} · ${c.env.label} · run ${runId}`,
		);
		return { ok: true };
	}

	private async ready(p: string, r: string, env: string) {
		try {
			return await this.context(p, r, env);
		} catch (err) {
			if (err instanceof NotReady) throw new HelperError(err.message, 409);
			throw err;
		}
	}

	private async vendor<T>(call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (err) {
			if (err instanceof VendorError)
				throw new HelperError(err.message, err.status >= 400 && err.status < 600 ? err.status : 502);
			throw err;
		}
	}
}

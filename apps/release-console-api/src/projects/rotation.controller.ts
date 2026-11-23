import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
	type RotateResult,
	type RotationView,
	type SecretsPlaces,
	afterRotate,
	clearPreviousSchema,
	graceDaysLeft,
	rotateRequestSchema,
	rotateResultSchema,
	secretsSourceOf,
} from '@saha-textile/release-console-contracts';

import { ProjectsService } from './projects.service.js';
import { parseBody } from '../common/parse.js';
import { LockService } from '../lock/lock.service.js';
import { sessionOf } from '../lock/session.guard.js';
import { HelperError, RunnerClient } from '../runner/runner-client.js';
import { ConsoleStore } from '../store/console-store.js';

type Req = Parameters<typeof sessionOf>[0];

/**
 * Run › Secrets › Rotate (Release Path brief, Part 3, approved 23 Nov). New values are made on the
 * owner's Mac by the Infisical chat's `pnpm secrets:rotate` and written into Infisical; the console
 * keeps names and dates only: which database, Redis and search values wait for a deploy with
 * rotation, and when old sign-in, CSRF and mailbox keys were kept (removed after 30 days).
 */
@Controller('api/projects/:p/repos/:r/rotation/:env')
export class RotationController {
	private readonly helper = new RunnerClient();

	constructor(
		private readonly projects: ProjectsService,
		private readonly lock: LockService,
		private readonly store: ConsoleStore,
	) {}

	/** The environment and its server tier in the name list, from its own "reads secrets from" place. */
	private async tierOf(p: string, r: string, env: string) {
		const { repo } = this.projects.repository(p, r);
		const e = repo.environments.find((x) => x.name === env);
		if (!e) throw new HelperError(`${repo.name} has no environment ${env}.`, 404);
		if (e.cloudId === null) return { env: e, tier: null };
		const source = secretsSourceOf(repo, env);
		if (source.kind !== 'infisical') return { env: e, tier: null };
		const places = await this.helper
			.call<SecretsPlaces>('GET', '/secrets/places')
			.catch(() => ({ places: [] }) as unknown as SecretsPlaces);
		const hit = places.places.find(
			(x) => x.project === source.place.project && x.environment === source.place.environment,
		);
		const tier = hit && hit.tier !== 'local' ? hit.tier : null;
		return { env: e, tier };
	}

	@Get()
	async view(@Param('p') p: string, @Param('r') r: string, @Param('env') env: string): Promise<RotationView> {
		const { tier } = await this.tierOf(p, r, env);
		const state = this.projects.rotation(p, r, env);
		return { environment: env, tier, state, graceDaysLeft: graceDaysLeft(state) };
	}

	/** Make new values: the PIN and the environment's name typed (brief Q6). */
	@Post()
	@HttpCode(200)
	async rotate(
		@Req() req: Req,
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') env: string,
		@Body() body: unknown,
	): Promise<RotationView> {
		const { pin, confirm, ids, grace } = parseBody(rotateRequestSchema, body);
		const { env: e, tier } = await this.tierOf(p, r, env);
		if (!tier) throw new HelperError(`${e.label} has no server tier in Infisical to rotate.`, 409);
		if (confirm.trim() !== e.name) throw new HelperError(`Type ${e.name} to confirm.`, 400);
		this.lock.confirm(sessionOf(req), pin, `rotate secrets of ${e.name}`);
		const result = await this.run({ tier, ids, grace });
		const next = this.projects.setRotation(p, r, env, afterRotate(this.projects.rotation(p, r, env), ids, result));
		this.store.audit(
			p,
			'secrets-rotated',
			`${e.label} · ${grace ? 'on a schedule' : 'after a leak'} · ${result.changed.join(', ') || 'nothing changed'}${result.movedToPrevious.length ? ` · kept as previous: ${result.movedToPrevious.join(', ')}` : ''}`,
		);
		return { environment: env, tier, state: next, graceDaysLeft: graceDaysLeft(next) };
	}

	/** Remove the old keys (brief R5): blanks the `_PREVIOUS` names; a normal deploy then carries it. */
	@Post('clear-previous')
	@HttpCode(200)
	async clearPrevious(
		@Req() req: Req,
		@Param('p') p: string,
		@Param('r') r: string,
		@Param('env') env: string,
		@Body() body: unknown,
	): Promise<RotationView> {
		const { pin } = parseBody(clearPreviousSchema, body);
		const { env: e, tier } = await this.tierOf(p, r, env);
		if (!tier) throw new HelperError(`${e.label} has no server tier in Infisical.`, 409);
		this.lock.confirm(sessionOf(req), pin, `remove the old keys of ${e.name}`);
		const result = await this.run({ tier, clearPrevious: true });
		const before = this.projects.rotation(p, r, env);
		const next = this.projects.setRotation(p, r, env, { ...before, graceAt: null, graceNames: [] });
		this.store.audit(
			p,
			'secrets-previous-removed',
			`${e.label} · ${result.clearedPrevious.join(', ') || 'none were kept'}`,
		);
		return { environment: env, tier, state: next, graceDaysLeft: null };
	}

	private async run(body: Record<string, unknown>): Promise<RotateResult> {
		const answer = await this.helper.call<unknown>('POST', '/secrets/rotate', body, 320_000);
		const parsed = rotateResultSchema.safeParse(answer);
		if (!parsed.success)
			throw new HelperError('The rotate script answered in a shape the console does not know.', 502);
		return parsed.data;
	}
}

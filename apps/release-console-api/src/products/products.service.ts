import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
	type KeyKind,
	type MonitorRange,
	type ProductJob,
	type ProductTab,
	type ProductWrite,
	type VendorAnswer,
	CONSOLE_KEYS_FOLDER,
	monitorRangeSchema,
} from '@saha-textile/release-console-contracts';

import type { Follow, ProductCtx, ProductScreen } from './kit.js';
import { PRODUCT_SCREENS } from './registry.js';
import { KeySourceService } from '../keys/key-source.js';
import { RequestLog } from '../local/request-log.js';
import { ProjectsService } from '../projects/projects.service.js';
import { ConsoleStore } from '../store/console-store.js';
import { VendorError } from '../vendors/http.js';

interface Running {
	job: ProductJob;
	projectId: string;
	repoId: string;
	follow: Follow[];
	key: string;
}

const KEYS: Record<ProductScreen['vendor'], { read: KeyKind; change: KeyKind; name: string }> = {
	digitalocean: { read: 'do-read', change: 'do-change', name: 'DigitalOcean' },
	cloudflare: { read: 'cf-read', change: 'cf-change', name: 'Cloudflare' },
	github: { read: 'github-token', change: 'github-token', name: 'GitHub' },
};
const STEP_EVERY_MS = 3000;
const GIVE_UP_MS = 30 * 60_000;

/**
 * Every DigitalOcean and Cloudflare product screen: reads with the narrow key, changes with the
 * full-access key after the PIN, records each change in the audit log, and follows it to the end.
 */
@Injectable()
export class ProductsService {
	private readonly jobs = new Map<string, Running>();

	constructor(
		private readonly projects: ProjectsService,
		private readonly store: ConsoleStore,
		private readonly keyFile: KeySourceService,
		private readonly requests: RequestLog,
	) {}

	/** Screens this console draws from live product reads, with their tabs and forms. */
	catalogue(): Record<string, { tabs: string[]; forms: string[] }> {
		return Object.fromEntries(
			Object.entries(PRODUCT_SCREENS).map(([k, s]) => [
				k,
				{ tabs: Object.keys(s.tabs), forms: Object.keys(s.forms ?? {}) },
			]),
		);
	}

	private screen(name: string): ProductScreen {
		const s = PRODUCT_SCREENS[name];
		if (!s) throw new NotFoundException(`No live screen ${name}.`);
		return s;
	}

	private async context(
		p: string,
		r: string,
		s: ProductScreen,
		id: string | null,
		range: MonitorRange,
	): Promise<VendorAnswer<ProductCtx>> {
		const { project, repo } = this.projects.repository(p, r);
		const want = KEYS[s.vendor];
		const slot =
			s.vendor === 'digitalocean'
				? repo.cloud.find((c) => c.vendor === 'digitalocean')
				: repo.edge.find((e) => e.vendor === 'cloudflare');
		if (!slot)
			return {
				state: 'not-connected',
				message: `This repository has no ${want.name} platform. Add it in the repository's settings.`,
			};
		const refs = project.keys.filter((k) => slot.keyIds.includes(k.id));
		const readRef = refs.find((k) => k.kind === want.read) ?? refs.find((k) => k.kind === want.change);
		if (!readRef)
			return {
				state: 'not-connected',
				message: `${want.name} is not connected. Paste a read token on the Connections screen.`,
			};
		const key = await this.projects.valueOf(readRef);
		if (!key)
			return {
				state: 'not-connected',
				message: `${readRef.label} has no value in the console's key file. Add ${readRef.envNames.join(' + ')} in Infisical (${CONSOLE_KEYS_FOLDER}), then run pnpm console:env.`,
			};
		const changeRef = s.vendor === 'github' ? readRef : refs.find((k) => k.kind === want.change);
		return {
			state: 'ok',
			readAt: new Date().toISOString(),
			data: {
				projectId: p,
				repo,
				key,
				zones: 'zones' in slot ? slot.zones : [],
				id,
				range,
				keyRefs: project.keys,
				consoleKey: (name: string) => this.keyFile.get(name) ?? null,
				recent: (action: string) => this.store.auditEntries(p, 500).filter((e) => e.action === action),
				recentAll: (action: string) => this.store.auditEntries(null, 500).filter((e) => e.action === action),
				repository: repo.sourceCode.repository,
				localRequests: (minutes: number) => this.requests.view(minutes).series,
				writeKey: async () => {
					const v = changeRef ? await this.projects.valueOf(changeRef) : null;
					if (!v)
						throw new VendorError(
							`Changing ${want.name} needs its full-access key: link it on the Connections screen (${CONSOLE_KEYS_FOLDER}).`,
							400,
						);
					return v;
				},
			},
		};
	}

	private async answer(run: () => Promise<ProductTab>): Promise<VendorAnswer<ProductTab>> {
		try {
			return { state: 'ok', readAt: new Date().toISOString(), data: await run() };
		} catch (err) {
			return {
				state: 'error',
				message:
					err instanceof VendorError
						? err.message
						: `The vendor could not be reached: ${(err as Error).message}`,
			};
		}
	}

	async tab(
		p: string,
		r: string,
		name: string,
		tab: string,
		id: string | null,
		range: string | undefined,
	): Promise<VendorAnswer<ProductTab>> {
		const s = this.screen(name);
		const read = s.tabs[tab];
		if (!read) throw new NotFoundException(`${name} has no live tab ${tab}.`);
		const ctx = await this.context(p, r, s, id, monitorRangeSchema.catch('24h').parse(range));
		if (ctx.state !== 'ok') return ctx;
		return this.answer(() => read(ctx.data));
	}

	async form(
		p: string,
		r: string,
		name: string,
		formKey: string,
		id: string | null,
	): Promise<VendorAnswer<ProductTab>> {
		const s = this.screen(name);
		const f = s.forms?.[formKey];
		if (!f) throw new NotFoundException(`${name} has no form ${formKey}.`);
		const ctx = await this.context(p, r, s, id, '24h');
		if (ctx.state !== 'ok') return ctx;
		return this.answer(() => f.read(ctx.data));
	}

	/** Sends a form (the PIN was checked by the controller) and follows it. */
	async send(p: string, r: string, name: string, formKey: string, w: ProductWrite): Promise<ProductJob> {
		const s = this.screen(name);
		const f = s.forms?.[formKey];
		if (!f) throw new NotFoundException(`${name} has no form ${formKey}.`);
		const ctx = await this.context(p, r, s, w.id, '24h');
		if (ctx.state !== 'ok') throw new BadRequestException(ctx.message);
		let sent;
		try {
			sent = await f.send(ctx.data, w);
		} catch (err) {
			const message =
				err instanceof VendorError ? err.message : `The vendor could not be reached: ${(err as Error).message}`;
			this.store.audit(p, `${name}-${formKey}-refused`, message);
			throw new BadRequestException(message);
		}
		const key = await ctx.data.writeKey().catch(() => ctx.data.key);
		const follow = sent.follow ?? [];
		const job: ProductJob = {
			id: randomUUID(),
			screen: name,
			form: formKey,
			target: sent.message,
			startedAt: new Date().toISOString(),
			finishedAt: follow.length ? null : new Date().toISOString(),
			state: follow.length ? 'running' : 'done',
			message: follow.length ? 'Sent; following it until the vendor says it finished.' : 'Done.',
			productId: sent.productId,
			steps: [
				{ label: `Sent to ${KEYS[s.vendor].name} with the PIN`, detail: sent.message, state: 'done' },
				...follow.map((x, i) => ({
					label: x.label,
					detail: '',
					state: i === 0 ? ('running' as const) : ('queued' as const),
				})),
			],
		};
		this.store.audit(p, `${name}-${formKey}`, `${sent.message}${sent.productId ? ` (${sent.productId})` : ''}`);
		this.jobs.set(job.id, { job, projectId: p, repoId: r, follow, key });
		if (follow.length) void this.run(job.id);
		return structuredClone(job);
	}

	private async run(id: string): Promise<void> {
		const j = this.jobs.get(id);
		if (!j) return;
		const started = Date.now();
		for (let i = 0; i < j.follow.length; i++) {
			const step = j.job.steps[i + 1];
			const f = j.follow[i];
			if (!step || !f) break;
			step.state = 'running';
			try {
				for (;;) {
					if (await f.check(j.key)) break;
					if (Date.now() - started > GIVE_UP_MS)
						throw new VendorError('Still not finished after 30 minutes; check the vendor’s own page.', 504);
					await new Promise((res) => setTimeout(res, STEP_EVERY_MS));
				}
				step.state = 'done';
				step.detail = f.detail?.() ?? step.detail;
			} catch (err) {
				step.state = 'failed';
				step.detail = err instanceof VendorError ? err.message : (err as Error).message;
				j.job.state = 'failed';
				j.job.message = `Stopped at "${f.label}": ${step.detail}`;
				j.job.finishedAt = new Date().toISOString();
				this.store.audit(
					j.projectId,
					`${j.job.screen}-${j.job.form}-failed`,
					`${j.job.target}: ${step.detail}`,
				);
				return;
			}
		}
		j.job.state = 'done';
		j.job.message = 'Done.';
		j.job.finishedAt = new Date().toISOString();
	}

	list(p: string, r: string, name: string): ProductJob[] {
		return [...this.jobs.values()]
			.filter((j) => j.projectId === p && j.repoId === r && j.job.screen === name)
			.map((j) => structuredClone(j.job))
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	}
}

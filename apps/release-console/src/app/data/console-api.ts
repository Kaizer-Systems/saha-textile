import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
	type AlertsView,
	alertsViewSchema,
	type RequestsView,
	requestsViewSchema,
	type SecretsView,
	secretsViewSchema,
	type AttentionCount,
	type DockerSnapshot,
	type HelperStatus,
	type Job,
	type LocalAction,
	type Logs,
	type MacSnapshot,
	type PipelineStage,
	type Series,
	type ShopHealth,
	type AttentionItem,
	type AuditEntry,
	type CloudAccount,
	type ConsoleView,
	type DnsRecord,
	type Droplet,
	type EdgeZone,
	type KeyRef,
	type LockStatus,
	type NewProject,
	type Project,
	type PullRequest,
	type Readiness,
	type Repository,
	type RepositoryFileFound,
	type RepositoryFileQuery,
	type ServicesSnapshot,
	type SlotKeys,
	type KeySource,
	type LinkKey,
	type SignInMethod,
	type Unlock,
	type UnlockAnswer,
	type VendorAnswer,
	type WorkflowRun,
	attentionCountsSchema,
	dockerSnapshotSchema,
	helperStatusSchema,
	jobSchema,
	jobsSchema,
	logsSchema,
	macSnapshotSchema,
	seriesListSchema,
	shopHealthSchema,
	attentionItemsSchema,
	auditEntriesSchema,
	cloudAccountAnswerSchema,
	consoleViewSchema,
	dnsRecordsAnswerSchema,
	dropletsAnswerSchema,
	edgeZonesAnswerSchema,
	keyRefSchema,
	keySourceSchema,
	lockStatusSchema,
	okAnswerSchema,
	projectSchema,
	pullRequestsAnswerSchema,
	readinessSchema,
	repositoryFileAnswerSchema,
	servicesSnapshotSchema,
	unlockAnswerSchema,
	workflowRunsAnswerSchema,
} from '@saha-textile/release-console-contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { ConsoleSession } from './session';

import type { z } from 'zod';

/**
 * Where the console's API answers. In its Docker image one process serves the page and the API, so
 * it is the page's own address. While developing (`pnpm console`), the API runs beside Vite on the
 * page's port plus 10 (4400 → 4410), on 127.0.0.1. Every answer is checked against the shared contracts.
 */
export const CONSOLE_API = import.meta.env.DEV
	? `http://127.0.0.1:${Number(globalThis.location?.port || 4400) + 10}`
	: (globalThis.location?.origin ?? '');

/** An answer the API refused, with its reason. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

@Injectable({ providedIn: 'root' })
export class ConsoleApi {
	private readonly session = inject(ConsoleSession);
	private readonly router = inject(Router);
	private readonly queries = inject(QueryClient);

	private async call<T>(
		method: Method,
		path: string,
		schema: z.ZodType<T>,
		body?: unknown,
		timeout = 20_000,
	): Promise<T> {
		const headers: Record<string, string> = {};
		const token = this.session.token();
		if (token) headers['x-console-session'] = token;
		if (body !== undefined) headers['content-type'] = 'application/json';
		const res = await fetch(`${CONSOLE_API}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeout),
		});
		if (res.status === 401 && !path.startsWith('/api/lock/')) this.forget();
		if (!res.ok) {
			const detail: unknown = await res.json().catch(() => null);
			const message =
				detail && typeof detail === 'object' ? (detail as Record<string, unknown>)['message'] : null;
			throw new ApiError(typeof message === 'string' ? message : `${path} answered ${res.status}`, res.status);
		}
		return schema.parse(await res.json());
	}

	/* lock */
	lockStatus(): Promise<LockStatus> {
		return this.call('GET', '/api/lock/status', lockStatusSchema);
	}
	setupPin(pin: string): Promise<UnlockAnswer> {
		return this.call('POST', '/api/lock/setup', unlockAnswerSchema, { pin });
	}
	/** Unlocks with the PIN or the password. */
	unlock(given: Unlock): Promise<UnlockAnswer> {
		return this.call('POST', '/api/lock/unlock', unlockAnswerSchema, given);
	}
	setPassword(pin: string, password: string): Promise<unknown> {
		return this.call('POST', '/api/lock/password', okAnswerSchema, { pin, password });
	}
	removePassword(pin: string): Promise<unknown> {
		return this.call('POST', '/api/lock/password/remove', okAnswerSchema, { pin });
	}
	setPreferred(pin: string, method: SignInMethod): Promise<unknown> {
		return this.call('POST', '/api/lock/preferred', okAnswerSchema, { pin, method });
	}
	/** Locks the console: ends the session on the API, forgets it and every cached answer here. */
	async lockNow(): Promise<void> {
		await this.call('POST', '/api/lock/lock', okAnswerSchema, {}).catch(() => undefined);
		this.forget();
	}
	private forget(): void {
		this.session.clear();
		this.queries.clear();
		void this.router.navigate(['/lock']);
	}
	changePin(current: string, next: string): Promise<unknown> {
		return this.call('POST', '/api/lock/pin', okAnswerSchema, { current, next });
	}

	/* projects and keys */
	projects(): Promise<ConsoleView> {
		return this.call('GET', '/api/projects', consoleViewSchema);
	}
	addProject(project: NewProject): Promise<Project> {
		return this.call('POST', '/api/projects', projectSchema, project);
	}
	removeProject(id: string): Promise<unknown> {
		return this.call('DELETE', `/api/projects/${id}`, okAnswerSchema);
	}
	/** Links a key to its Infisical names; no value is sent. */
	linkKey(projectId: string, key: LinkKey): Promise<KeyRef> {
		return this.call('POST', `/api/projects/${projectId}/keys`, keyRefSchema, key, 40_000);
	}
	checkKey(projectId: string, keyId: string): Promise<KeyRef> {
		return this.call('POST', `/api/projects/${projectId}/keys/${keyId}/check`, keyRefSchema, {}, 40_000);
	}
	removeKey(projectId: string, keyId: string): Promise<unknown> {
		return this.call('DELETE', `/api/projects/${projectId}/keys/${keyId}`, okAnswerSchema);
	}
	setSlotKeys(projectId: string, slot: SlotKeys): Promise<Project> {
		return this.call('PUT', `/api/projects/${projectId}/slots`, projectSchema, slot);
	}
	addRepository(projectId: string, repo: Repository): Promise<Project> {
		return this.call('POST', `/api/projects/${projectId}/repositories`, projectSchema, repo);
	}
	updateRepository(projectId: string, repo: Repository): Promise<Project> {
		return this.call('PUT', `/api/projects/${projectId}/repositories/${repo.id}`, projectSchema, repo);
	}
	removeRepository(projectId: string, repoId: string): Promise<Project> {
		return this.call('DELETE', `/api/projects/${projectId}/repositories/${repoId}`, projectSchema);
	}
	/** A repository's own menus from its `.release-console.json`, read through the GitHub CLI sign-in. */
	repositoryFile(q: RepositoryFileQuery): Promise<VendorAnswer<RepositoryFileFound>> {
		return this.call('POST', '/api/repository-file', repositoryFileAnswerSchema, q);
	}

	/* attention and audit */
	/** The console's key file: names present and missing, never values. */
	keySource(): Promise<KeySource> {
		return this.call('GET', '/api/key-source', keySourceSchema);
	}

	attentionCounts(): Promise<AttentionCount[]> {
		return this.call('GET', '/api/attention', attentionCountsSchema, undefined, 40_000);
	}
	attention(projectId: string): Promise<AttentionItem[]> {
		return this.call('GET', `/api/projects/${projectId}/attention`, attentionItemsSchema, undefined, 40_000);
	}
	audit(projectId: string | null): Promise<AuditEntry[]> {
		return this.call(
			'GET',
			`/api/audit${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`,
			auditEntriesSchema,
		);
	}

	/* vendor reads */
	pulls(p: string, r: string): Promise<VendorAnswer<PullRequest[]>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/github/pulls`, pullRequestsAnswerSchema);
	}
	runs(p: string, r: string): Promise<VendorAnswer<WorkflowRun[]>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/github/runs`, workflowRunsAnswerSchema);
	}
	droplets(p: string, r: string, slot: string): Promise<VendorAnswer<Droplet[]>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/cloud/${slot}/droplets`, dropletsAnswerSchema);
	}
	cloudAccount(p: string, r: string, slot: string): Promise<VendorAnswer<CloudAccount>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/cloud/${slot}/account`, cloudAccountAnswerSchema);
	}
	zones(p: string, r: string, slot: string): Promise<VendorAnswer<EdgeZone[]>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/edge/${slot}/zones`, edgeZonesAnswerSchema);
	}
	dns(p: string, r: string, slot: string, zone: string): Promise<VendorAnswer<DnsRecord[]>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/edge/${slot}/zones/${encodeURIComponent(zone)}/dns`,
			dnsRecordsAnswerSchema,
		);
	}

	/* this Mac, through the Mac helper */
	helper(): Promise<HelperStatus> {
		return this.call('GET', '/api/local/helper', helperStatusSchema);
	}
	mac(): Promise<MacSnapshot> {
		return this.call('GET', '/api/local/mac', macSnapshotSchema);
	}
	docker(): Promise<DockerSnapshot> {
		return this.call('GET', '/api/local/docker', dockerSnapshotSchema, undefined, 40_000);
	}
	shopHealth(): Promise<ShopHealth> {
		return this.call('GET', '/api/local/shop-health', shopHealthSchema);
	}
	logs(container: string, tail: number, since: string): Promise<Logs> {
		return this.call(
			'GET',
			`/api/local/logs?container=${encodeURIComponent(container)}&tail=${tail}&since=${since}`,
			logsSchema,
		);
	}
	history(source: string, names: string[], minutes: number): Promise<Series[]> {
		return this.call(
			'GET',
			`/api/local/history?source=${encodeURIComponent(source)}&names=${names.join(',')}&minutes=${minutes}`,
			seriesListSchema,
		);
	}
	requests(minutes: number): Promise<RequestsView> {
		return this.call('GET', `/api/local/requests?minutes=${minutes}`, requestsViewSchema);
	}
	secrets(fresh = false): Promise<SecretsView> {
		return this.call('GET', `/api/local/secrets${fresh ? '?fresh=1' : ''}`, secretsViewSchema, undefined, 200_000);
	}
	alerts(): Promise<AlertsView> {
		return this.call('GET', '/api/local/alerts', alertsViewSchema);
	}
	jobs(): Promise<Job[]> {
		return this.call('GET', '/api/local/jobs', jobsSchema);
	}
	job(id: string, after = 0): Promise<Job> {
		return this.call('GET', `/api/local/jobs/${id}?after=${after}`, jobSchema);
	}
	runLocal(
		action: LocalAction,
		pin: string,
		stages: { from?: PipelineStage; only?: PipelineStage } = {},
	): Promise<Job> {
		return this.call('POST', `/api/local/run/${action}`, jobSchema, { pin, ...stages }, 30_000);
	}
	stopJob(id: string, pin: string): Promise<Job> {
		return this.call('POST', `/api/local/jobs/${id}/stop`, jobSchema, { pin });
	}

	/* local stack (this computer) */
	localServices(repo: string): Promise<ServicesSnapshot> {
		return this.call('GET', `/api/local/services?repo=${encodeURIComponent(repo)}`, servicesSnapshotSchema);
	}
	localReadiness(repo: string): Promise<Readiness> {
		return this.call('GET', `/api/local/readiness?repo=${encodeURIComponent(repo)}`, readinessSchema);
	}
}

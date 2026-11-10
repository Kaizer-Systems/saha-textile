import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

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
	type StoreKey,
	type UnlockAnswer,
	type VendorAnswer,
	type WorkflowRun,
	attentionCountsSchema,
	attentionItemsSchema,
	auditEntriesSchema,
	cloudAccountAnswerSchema,
	consoleViewSchema,
	dnsRecordsAnswerSchema,
	dropletsAnswerSchema,
	edgeZonesAnswerSchema,
	keyRefSchema,
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
 * The console's local API on this computer: the page's own port plus 10 (4400 → 4410), on
 * 127.0.0.1 only. Every answer is checked against the shared contracts.
 */
export const CONSOLE_API = `http://127.0.0.1:${Number(globalThis.location?.port || 4400) + 10}`;

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
	unlock(pin: string): Promise<UnlockAnswer> {
		return this.call('POST', '/api/lock/unlock', unlockAnswerSchema, { pin });
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
	storeKey(projectId: string, key: StoreKey): Promise<KeyRef> {
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

	/* local stack (this computer) */
	localServices(repo: string): Promise<ServicesSnapshot> {
		return this.call('GET', `/api/local/services?repo=${encodeURIComponent(repo)}`, servicesSnapshotSchema);
	}
	localReadiness(repo: string): Promise<Readiness> {
		return this.call('GET', `/api/local/readiness?repo=${encodeURIComponent(repo)}`, readinessSchema);
	}
}

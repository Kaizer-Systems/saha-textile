import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
	type AlertsView,
	alertsViewSchema,
	type RequestsView,
	requestsViewSchema,
	type SaveSecrets,
	type SaveSecretsResult,
	saveSecretsResultSchema,
	type SecretsPlaces,
	type ReviewServerDeploy,
	type ServerDeployView,
	serverDeployAnswerSchema,
	type SecretsView,
	secretsPlacesSchema,
	secretsViewSchema,
	type AttentionCount,
	type DockerSnapshot,
	type HelperStatus,
	type Job,
	type GithubStatus,
	githubStatusSchema,
	type GithubCheck,
	githubCheckSchema,
	type GithubTokenLoginResult,
	githubTokenLoginResultSchema,
	type LocalAction,
	type Logs,
	type MacSnapshot,
	type PipelineStage,
	type Series,
	type ShopHealth,
	type AttentionItem,
	type AuditEntry,
	type CloudAccount,
	type DoCatalog,
	type DropletJob,
	type StartDropletCreate,
	type StartDropletDestroy,
	type StartServerFix,
	type Reachable,
	reachableSchema,
	type ServerState,
	serverStateSchema,
	type ServerLogs,
	serverLogsSchema,
	type DbReport,
	dbReportSchema,
	type TracesList,
	tracesListSchema,
	type TraceView,
	type TracingView,
	traceViewSchema,
	tracingViewSchema,
	type DeployToken,
	deployTokensSchema,
	type ConsoleView,
	type DnsRecord,
	type Droplet,
	type EdgeZone,
	type KeyRef,
	type LockStatus,
	type NewProject,
	type Project,
	type PullCommitPage,
	type PullCommits,
	type PullDiff,
	type PullFiles,
	type PullBasePreview,
	type ConsoleApiHealth,
	type RepoInfo,
	type CodeTree,
	type CodeDoc,
	type CodeRefs,
	type CodePaths,
	type CodeFile,
	type CodeBlame,
	type CodeHistory,
	type CodeBranches,
	type BranchRules,
	type CodeTags,
	type CodeReleases,
	type ReleaseNotes,
	type CodeSearch,
	type CodeActivity,
	type CodeCompare,
	type CodeDone,
	type CodeHtml,
	type CodePackages,
	type PullLog,
	type PullPage,
	type PullRow,
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
	doCatalogAnswerSchema,
	dropletJobSchema,
	dropletJobsSchema,
	productJobSchema,
	productJobsSchema,
	productTabAnswerSchema,
	type ProductJob,
	type ProductTab,
	type ProductWrite,
	sshListAnswerSchema,
	envTagsSchema,
	type EnvTags,
	type SetEnvTag,
	consoleViewSchema,
	dnsRecordsAnswerSchema,
	dropletsAnswerSchema,
	edgeZonesAnswerSchema,
	keyRefSchema,
	keySourceSchema,
	lockStatusSchema,
	okAnswerSchema,
	projectSchema,
	pullCommitPageAnswerSchema,
	pullCommitsAnswerSchema,
	pullDiffAnswerSchema,
	pullFilesAnswerSchema,
	pullLogAnswerSchema,
	pullBasePreviewAnswerSchema,
	consoleApiHealthSchema,
	repoInfoAnswerSchema,
	codeTreeAnswerSchema,
	codeDocAnswerSchema,
	codeRefsAnswerSchema,
	codePathsAnswerSchema,
	codeFileAnswerSchema,
	codeBlameAnswerSchema,
	codeHistoryAnswerSchema,
	codeBranchesAnswerSchema,
	branchRulesAnswerSchema,
	codeTagsAnswerSchema,
	codeReleasesAnswerSchema,
	releaseNotesAnswerSchema,
	codeSearchAnswerSchema,
	codeActivityAnswerSchema,
	codeCompareAnswerSchema,
	codeDoneSchema,
	codeHtmlAnswerSchema,
	codePackagesAnswerSchema,
	pullPageAnswerSchema,
	pullRowsAnswerSchema,
	readinessSchema,
	repositoryFileAnswerSchema,
	branchesSchema,
	domainsAnswerSchema,
	securityAnswerSchema,
	releasesAnswerSchema,
	type ReleasesView,
	type SecurityView,
	type DomainsView,
	type Branches,
	servicesSnapshotSchema,
	unlockAnswerSchema,
	workflowRunsAnswerSchema,
	type NotFoundView,
	notFoundViewSchema,
	type SitemapCheck,
	type ClientBuildsView,
	clientBuildsViewSchema,
	type OpsJobsView,
	opsJobsAnswerSchema,
	type OpsMessagesView,
	opsMessagesAnswerSchema,
	type RotateRequest,
	type RotationView,
	rotationViewSchema,
	type CoverageFileAnswer,
	type CoverageRuns,
	type CoverageSource,
	type CoverageTreeAnswer,
	coverageFileAnswerSchema,
	coverageRunsSchema,
	coverageTreeAnswerSchema,
	vendorAnswer,
} from '@saha-textile/release-console-contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { z } from 'zod';

import { SecretDrafts } from './secret-drafts';
import { ConsoleSession } from './session';

const productScreensSchema = z.record(
	z.string(),
	z.object({
		tabs: z.array(z.string()),
		forms: z.array(z.string()),
		vendor: z.enum(['digitalocean', 'cloudflare', 'github', 'local']),
	}),
);

/**
 * Where the console's API answers. In its Docker image one process serves the page and the API, so
 * it is the page's own address. While developing (`pnpm console`), the API runs beside Vite on the
 * page's port plus 10 (4400 → 4410), on 127.0.0.1. Every answer is checked against the shared contracts.
 */
export function consoleApiBase(dev: boolean, location: { port: string; origin: string } | undefined): string {
	return dev ? `http://127.0.0.1:${Number(location?.port || 4400) + 10}` : (location?.origin ?? '');
}
export const CONSOLE_API = consoleApiBase(import.meta.env.DEV, globalThis.location);

/** An answer the API refused, with its reason. */
/** Which run to read: a CI run's id or this Mac's, and the change whose lines to mark ('commit' or a branch). */
export interface CoverageQuery {
	source: CoverageSource;
	run: string;
	base?: string | null;
}
const coverageTreeAnswer = vendorAnswer(coverageTreeAnswerSchema);
const coverageFileAnswer = vendorAnswer(coverageFileAnswerSchema);
const codeDoneAnswer = vendorAnswer(codeDoneSchema);
export function coverageQuery(q: CoverageQuery & { path?: string }): string {
	const p = new URLSearchParams({ source: q.source, run: q.run });
	if (q.base) p.set('base', q.base);
	if (q.path) p.set('path', q.path);
	return p.toString();
}

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
	private readonly drafts = inject(SecretDrafts);
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
		this.drafts.clear();
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
	/** A repository's branches for the pickers; `refresh` runs git fetch on this computer first. */
	repositoryBranches(repository: string, refresh = false): Promise<Branches> {
		const q = `repository=${encodeURIComponent(repository)}${refresh ? '&refresh=1' : ''}`;
		return this.call('GET', `/api/repository-branches?${q}`, branchesSchema, undefined, 90_000);
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
	/* Ship › Code › Pull requests: the list and each pull request's page (brief E5WE6RSF2AJvpxDyDA1EJt) */
	pulls(p: string, r: string, state: 'open' | 'closed' = 'open'): Promise<VendorAnswer<PullRow[]>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/github/pulls?state=${state}`, pullRowsAnswerSchema);
	}
	pull(p: string, r: string, n: number): Promise<VendorAnswer<PullPage>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/github/pulls/${n}`,
			pullPageAnswerSchema,
			undefined,
			60_000,
		);
	}
	pullCommits(p: string, r: string, n: number, page: number): Promise<VendorAnswer<PullCommits>> {
		const path = `/api/projects/${p}/repos/${r}/github/pulls/${n}/commits?page=${page}`;
		return this.call('GET', path, pullCommitsAnswerSchema, undefined, 60_000);
	}
	pullCommit(p: string, r: string, n: number, sha: string): Promise<VendorAnswer<PullCommitPage>> {
		const path = `/api/projects/${p}/repos/${r}/github/pulls/${n}/commits/${sha}`;
		return this.call('GET', path, pullCommitPageAnswerSchema, undefined, 60_000);
	}
	/** A pull request past GitHub's 3,000 files is read from the console's own copy: the first read can take minutes. */
	pullFiles(p: string, r: string, n: number): Promise<VendorAnswer<PullFiles>> {
		const path = `/api/projects/${p}/repos/${r}/github/pulls/${n}/files`;
		return this.call('GET', path, pullFilesAnswerSchema, undefined, 600_000);
	}
	pullDiff(
		p: string,
		r: string,
		n: number,
		path: string,
		whole: boolean,
		commit: string | null,
	): Promise<VendorAnswer<PullDiff>> {
		const q = new URLSearchParams({ path, whole: whole ? '1' : '0', ...(commit ? { commit } : {}) });
		const at = `/api/projects/${p}/repos/${r}/github/pulls/${n}/diff?${q.toString()}`;
		return this.call('GET', at, pullDiffAnswerSchema, undefined, 300_000);
	}
	pullLog(p: string, r: string, n: number, job: number): Promise<VendorAnswer<PullLog>> {
		const path = `/api/projects/${p}/repos/${r}/github/pulls/${n}/checks/${job}/log`;
		return this.call('GET', path, pullLogAnswerSchema, undefined, 60_000);
	}
	/* Ship › Code › Code (brief 7Hu1SuB3A8qiJzeDwvFZLR, Part C) */
	private code(p: string, r: string, at: string, q: Record<string, string> = {}): string {
		const query = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '')).toString();
		return `/api/projects/${p}/repos/${r}/github/code/${at}${query ? `?${query}` : ''}`;
	}
	codeRepo(p: string, r: string): Promise<VendorAnswer<RepoInfo>> {
		return this.call('GET', this.code(p, r, 'repo'), repoInfoAnswerSchema, undefined, 120_000);
	}
	codeTree(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeTree>> {
		return this.call('GET', this.code(p, r, 'tree', { ref, path }), codeTreeAnswerSchema, undefined, 300_000);
	}
	codeDoc(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeDoc>> {
		return this.call('GET', this.code(p, r, 'doc', { ref, path }), codeDocAnswerSchema, undefined, 60_000);
	}
	codeRefs(p: string, r: string): Promise<VendorAnswer<CodeRefs>> {
		return this.call('GET', this.code(p, r, 'refs'), codeRefsAnswerSchema, undefined, 60_000);
	}
	codePaths(p: string, r: string, ref: string): Promise<VendorAnswer<CodePaths>> {
		return this.call('GET', this.code(p, r, 'paths', { ref }), codePathsAnswerSchema, undefined, 300_000);
	}
	codeFile(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeFile>> {
		return this.call('GET', this.code(p, r, 'file', { ref, path }), codeFileAnswerSchema, undefined, 300_000);
	}
	codeBlame(p: string, r: string, ref: string, path: string): Promise<VendorAnswer<CodeBlame>> {
		return this.call('GET', this.code(p, r, 'blame', { ref, path }), codeBlameAnswerSchema, undefined, 300_000);
	}
	codeHistory(p: string, r: string, q: Record<string, string>): Promise<VendorAnswer<CodeHistory>> {
		return this.call('GET', this.code(p, r, 'history', q), codeHistoryAnswerSchema, undefined, 60_000);
	}
	codeBranches(p: string, r: string): Promise<VendorAnswer<CodeBranches>> {
		return this.call('GET', this.code(p, r, 'branches'), codeBranchesAnswerSchema, undefined, 120_000);
	}
	codeRules(p: string, r: string, branch: string): Promise<VendorAnswer<BranchRules>> {
		return this.call('GET', this.code(p, r, 'rules', { branch }), branchRulesAnswerSchema);
	}
	codeTags(p: string, r: string, after: string): Promise<VendorAnswer<CodeTags>> {
		return this.call('GET', this.code(p, r, 'tags', { after }), codeTagsAnswerSchema);
	}
	codeReleases(p: string, r: string, page: number): Promise<VendorAnswer<CodeReleases>> {
		return this.call('GET', this.code(p, r, 'releases', { page: String(page) }), codeReleasesAnswerSchema);
	}
	codeNotes(p: string, r: string, q: Record<string, string>): Promise<VendorAnswer<ReleaseNotes>> {
		return this.call('GET', this.code(p, r, 'notes', q), releaseNotesAnswerSchema, undefined, 60_000);
	}
	codeSearch(p: string, r: string, ref: string, q: string): Promise<VendorAnswer<CodeSearch>> {
		return this.call('GET', this.code(p, r, 'search', { ref, q }), codeSearchAnswerSchema, undefined, 300_000);
	}
	codeActivity(p: string, r: string, q: Record<string, string>): Promise<VendorAnswer<CodeActivity>> {
		return this.call('GET', this.code(p, r, 'activity', q), codeActivityAnswerSchema);
	}
	codeCompare(p: string, r: string, base: string, head: string): Promise<VendorAnswer<CodeCompare>> {
		return this.call(
			'GET',
			this.code(p, r, 'compare', { base, head }),
			codeCompareAnswerSchema,
			undefined,
			300_000,
		);
	}
	codeCompareDiff(
		p: string,
		r: string,
		q: { base: string; head: string; path: string; whole: boolean },
	): Promise<VendorAnswer<PullDiff>> {
		const at = this.code(p, r, 'compare/diff', { ...q, whole: q.whole ? '1' : '0' });
		return this.call('GET', at, pullDiffAnswerSchema, undefined, 300_000);
	}
	/** A change on the Code pages, with the PIN in its body; the answer says what changed or why not. */
	codeChange(p: string, r: string, action: string, body: object): Promise<VendorAnswer<CodeDone>> {
		return this.call('POST', this.code(p, r, action), codeDoneAnswer, body, 300_000);
	}
	/** Markdown drawn by GitHub while editing (Preview). */
	codeMarkdown(p: string, r: string, text: string): Promise<VendorAnswer<CodeHtml>> {
		return this.call('POST', this.code(p, r, 'markdown'), codeHtmlAnswerSchema, { text }, 60_000);
	}
	codePackages(p: string, r: string): Promise<VendorAnswer<CodePackages>> {
		return this.call('GET', this.code(p, r, 'packages'), codePackagesAnswerSchema);
	}
	/** A file's bytes (a picture, Raw, Download), read with the session like every other call. */
	codeRaw(p: string, r: string, ref: string, path: string): Promise<Blob> {
		return this.bytes(this.code(p, r, 'raw', { ref, path }));
	}
	/** A ref's files as GitHub's .zip (Code ▾ › Download ZIP). */
	codeZip(p: string, r: string, ref: string): Promise<Blob> {
		return this.bytes(this.code(p, r, 'zip', { ref }));
	}
	private async bytes(path: string): Promise<Blob> {
		const token = this.session.token();
		const res = await fetch(`${CONSOLE_API}${path}`, {
			headers: token ? { 'x-console-session': token } : {},
			signal: AbortSignal.timeout(300_000),
		});
		if (res.status === 401) this.forget();
		if (!res.ok) throw new ApiError(await res.text(), res.status);
		return res.blob();
	}
	/** The console API's liveness, with the fingerprint of the app it serves (newer-version notice). */
	health(): Promise<ConsoleApiHealth> {
		return this.call('GET', '/api/health', consoleApiHealthSchema, undefined, 10_000);
	}
	/** What the pull request would hold with another base (Change the base branch); counting past 300 files takes the copy. */
	pullBasePreview(p: string, r: string, n: number, base: string): Promise<VendorAnswer<PullBasePreview>> {
		const at = `/api/projects/${p}/repos/${r}/github/pulls/${n}/base-preview?${new URLSearchParams({ base }).toString()}`;
		return this.call('GET', at, pullBasePreviewAnswerSchema, undefined, 300_000);
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
	/* product screens (DigitalOcean and Cloudflare lifecycle, brief v7) */
	productScreens(): Promise<z.infer<typeof productScreensSchema>> {
		return this.call('GET', '/api/product-screens', productScreensSchema);
	}
	productTab(
		p: string,
		r: string,
		screen: string,
		tab: string,
		id: string | null,
		range: string,
	): Promise<VendorAnswer<ProductTab>> {
		const q = new URLSearchParams({ range, ...(id ? { id } : {}) });
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/products/${screen}/tab/${tab}?${q.toString()}`,
			productTabAnswerSchema,
			undefined,
			60_000,
		);
	}
	productForm(
		p: string,
		r: string,
		screen: string,
		form: string,
		id: string | null,
	): Promise<VendorAnswer<ProductTab>> {
		const q = id ? `?id=${encodeURIComponent(id)}` : '';
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/products/${screen}/form/${form}${q}`,
			productTabAnswerSchema,
			undefined,
			60_000,
		);
	}
	sendProductForm(p: string, r: string, screen: string, form: string, body: ProductWrite): Promise<ProductJob> {
		return this.call(
			'POST',
			`/api/projects/${p}/repos/${r}/products/${screen}/form/${form}`,
			productJobSchema,
			body,
			120_000,
		);
	}
	productJobs(p: string, r: string, screen: string): Promise<ProductJob[]> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/products/${screen}/jobs`, productJobsSchema);
	}
	/** Who may sign in over SSH to the project's servers; every server's Access rule follows. */
	setSshEmails(p: string, body: { pin: string; emails: string[] }): Promise<{ emails: string[]; hosts: string[] }> {
		return this.call('PUT', `/api/projects/${p}/ssh-emails`, sshListAnswerSchema, body, 120_000);
	}
	/** Which environment each cloud resource is for (resource key → environment name). */
	envTags(p: string, r: string): Promise<EnvTags> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/env-tags`, envTagsSchema);
	}
	/** Tags a resource with one of the repository's environments, or clears it, after the PIN. */
	setEnvTag(p: string, r: string, body: SetEnvTag): Promise<EnvTags> {
		return this.call('PUT', `/api/projects/${p}/repos/${r}/env-tags`, envTagsSchema, body);
	}
	/** DigitalOcean › Droplets: create a server after the PIN; the screen follows the job. */
	createDroplet(p: string, r: string, slot: string, body: StartDropletCreate): Promise<DropletJob> {
		return this.call(
			'POST',
			`/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/create`,
			dropletJobSchema,
			body,
			120_000,
		);
	}
	destroyDroplet(p: string, r: string, slot: string, body: StartDropletDestroy): Promise<DropletJob> {
		return this.call(
			'POST',
			`/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/destroy`,
			dropletJobSchema,
			body,
			60_000,
		);
	}
	dropletJob(p: string, r: string, slot: string, id: string): Promise<DropletJob> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/${id}`, dropletJobSchema);
	}
	dropletJobs(p: string, r: string, slot: string): Promise<DropletJob[]> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs`, dropletJobsSchema);
	}
	/** A server environment's live state: DigitalOcean monitoring, the shop's /ops, the observer (C12). */
	serverState(p: string, r: string, env: string): Promise<ServerState> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/server-state/${env}`,
			serverStateSchema,
			undefined,
			45_000,
		);
	}
	/** One service's last log lines on a server, through the observer login (C12). */
	serverLogs(p: string, r: string, env: string, service: string, errors = false): Promise<ServerLogs> {
		const q = new URLSearchParams({ service, since: '15', errors: errors ? '1' : '0' });
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/server-state/${env}/logs?${q.toString()}`,
			serverLogsSchema,
			undefined,
			60_000,
		);
	}
	/** Database monitor on this Mac: the same report with the local read-only monitor login (Q9). */
	localDbReport(): Promise<DbReport | { error: string }> {
		return this.call(
			'GET',
			'/api/local/db-report',
			z.union([dbReportSchema, z.object({ error: z.string() })]),
			undefined,
			75_000,
		);
	}
	/** Database monitor on a server: observe.sh db-report with the read-only monitor login (Q9). */
	dbReport(p: string, r: string, env: string): Promise<DbReport | { error: string }> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/server-state/${env}/db-report`,
			z.union([dbReportSchema, z.object({ error: z.string() })]),
			undefined,
			75_000,
		);
	}
	/* Ship › Code › Coverage (brief CRmpBdP3ce62g1JoCAhh23): CI runs and this Mac, a run's tree, one file. */
	coverageRuns(p: string, r: string): Promise<CoverageRuns> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/coverage/runs`, coverageRunsSchema, undefined, 60_000);
	}
	/** The first read of a CI run downloads and adds up its reports (about 4 MB zipped), so it may take a while. */
	coverageTree(p: string, r: string, q: CoverageQuery): Promise<VendorAnswer<CoverageTreeAnswer>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/coverage/tree?${coverageQuery(q)}`,
			coverageTreeAnswer,
			undefined,
			180_000,
		);
	}
	coverageFile(p: string, r: string, q: CoverageQuery & { path: string }): Promise<VendorAnswer<CoverageFileAnswer>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/coverage/file?${coverageQuery(q)}`,
			coverageFileAnswer,
			undefined,
			180_000,
		);
	}
	/** This computer's traces: the slowest or the failed of the last hour (Release Path brief Part 6). */
	traces(view: 'slowest' | 'errors'): Promise<TracesList> {
		return this.call('GET', `/api/local/traces?view=${view}`, tracesListSchema, undefined, 60_000);
	}
	/** One trace's waterfall with its rule-based Diagnose. */
	trace(id: string): Promise<TraceView> {
		return this.call('GET', `/api/local/traces/${id}`, traceViewSchema, undefined, 60_000);
	}
	/** Reachable through Cloudflare, check by check (Release Path brief C8). */
	reachable(p: string, r: string, slot: string, env: string): Promise<Reachable> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/reachable/${env}`,
			reachableSchema,
			undefined,
			60_000,
		);
	}
	/** The reachable card's one-click repair, after the PIN. */
	fixReachable(p: string, r: string, slot: string, env: string, pin: string): Promise<Reachable> {
		return this.call(
			'POST',
			`/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/reachable/${env}/fix`,
			reachableSchema,
			{ pin, fix: 'origin-pulls' },
			60_000,
		);
	}
	/** Each server's deploy token and its end date (Release Path brief C6). */
	deployTokens(p: string, r: string, slot: string): Promise<DeployToken[]> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/tokens`, deployTokensSchema);
	}
	/** Finish setup or Renew token for a server that exists, after the PIN (Release Path brief C5, C6). */
	serverFix(p: string, r: string, slot: string, body: StartServerFix): Promise<DropletJob> {
		return this.call(
			'POST',
			`/api/projects/${p}/repos/${r}/cloud/${slot}/droplet-jobs/fix`,
			dropletJobSchema,
			body,
			60_000,
		);
	}
	/** Everything DigitalOcean's create steps choose from (the Marketplace is long, so a longer wait). */
	doCatalog(p: string, r: string, slot: string): Promise<VendorAnswer<DoCatalog>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/cloud/${slot}/catalog`,
			doCatalogAnswerSchema,
			undefined,
			60_000,
		);
	}
	/** Releases: what each environment's branch has that the next one's lacks. */
	releases(p: string, r: string): Promise<VendorAnswer<ReleasesView>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/releases`, releasesAnswerSchema, undefined, 60_000);
	}
	/** Dependencies and security: GitHub's open Dependabot and code-scanning alerts. */
	security(p: string, r: string): Promise<VendorAnswer<SecurityView>> {
		return this.call('GET', `/api/projects/${p}/repos/${r}/security`, securityAnswerSchema, undefined, 60_000);
	}
	/** Certificates and domains: the edge slot's certificates and a handshake with each server domain. */
	certificates(p: string, r: string, slot: string): Promise<VendorAnswer<DomainsView>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/edge/${slot}/certificates`,
			domainsAnswerSchema,
			undefined,
			60_000,
		);
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
	/** One environment's background queues, from the shop API's read-only `/ops` (Job queues). */
	opsJobs(p: string, r: string, env: string): Promise<VendorAnswer<OpsJobsView>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/ops/${env}/jobs`,
			opsJobsAnswerSchema,
			undefined,
			30_000,
		);
	}
	/** One environment's sent messages of the last 24 hours, from `/ops` (Messages). */
	opsMessages(p: string, r: string, env: string): Promise<VendorAnswer<OpsMessagesView>> {
		return this.call(
			'GET',
			`/api/projects/${p}/repos/${r}/ops/${env}/messages`,
			opsMessagesAnswerSchema,
			undefined,
			30_000,
		);
	}
	/** Which client builds of the shop and admin called in the last hours (Client versions). */
	clientBuilds(hours: number): Promise<ClientBuildsView> {
		return this.call('GET', `/api/local/client-builds?hours=${hours}`, clientBuildsViewSchema);
	}
	/** The shop's "page not found" answers of the last hours, by path (Search engines). */
	notFound(hours: number): Promise<NotFoundView> {
		return this.call('GET', `/api/local/not-found?hours=${hours}`, notFoundViewSchema);
	}
	/** Starts the Mac helper's sitemap check for one environment's site; read only, no PIN. */
	sitemapCheck(where: SitemapCheck): Promise<Job> {
		return this.call('POST', '/api/local/seo/sitemap-check', jobSchema, where);
	}
	requests(minutes: number): Promise<RequestsView> {
		return this.call('GET', `/api/local/requests?minutes=${minutes}`, requestsViewSchema);
	}
	/** A server environment's deploy runs on GitHub, and whether its GitHub environment is set up. */
	serverDeploy(projectId: string, repoId: string, environment: string): Promise<VendorAnswer<ServerDeployView>> {
		return this.call(
			'GET',
			`/api/projects/${projectId}/repos/${repoId}/server-deploy/${environment}`,
			serverDeployAnswerSchema,
			undefined,
			60_000,
		) as Promise<VendorAnswer<ServerDeployView>>;
	}
	/** Starts deploy.yml for a server environment after the PIN. */
	startServerDeploy(
		projectId: string,
		repoId: string,
		environment: string,
		pin: string,
		allowBlank: string[] = [],
		confirm?: string,
		branch?: string,
		/** Rotation, a rollback or an older version (Release Path brief 3.2, F16). */
		extra: { rotate?: boolean; restartDatabase?: boolean; action?: 'deploy' | 'rollback'; tag?: string } = {},
	): Promise<unknown> {
		return this.call(
			'POST',
			`/api/projects/${projectId}/repos/${repoId}/server-deploy/${environment}`,
			okAnswerSchema,
			{ pin, allowBlank, ...(confirm ? { confirm } : {}), ...(branch ? { branch } : {}), ...extra },
			60_000,
		);
	}
	/** Run › Secrets › Rotate for one environment: its tier and what rotations left behind (names only). */
	rotation(projectId: string, repoId: string, environment: string): Promise<RotationView> {
		return this.call(
			'GET',
			`/api/projects/${projectId}/repos/${repoId}/rotation/${environment}`,
			rotationViewSchema,
		);
	}
	/** Make new values in Infisical on this Mac (PIN and the environment's name typed). */
	rotate(projectId: string, repoId: string, environment: string, body: RotateRequest): Promise<RotationView> {
		return this.call(
			'POST',
			`/api/projects/${projectId}/repos/${repoId}/rotation/${environment}`,
			rotationViewSchema,
			body,
			330_000,
		);
	}
	/** Remove the old keys kept 30 days; a normal deploy then carries the change. */
	clearPreviousKeys(projectId: string, repoId: string, environment: string, pin: string): Promise<RotationView> {
		return this.call(
			'POST',
			`/api/projects/${projectId}/repos/${repoId}/rotation/${environment}/clear-previous`,
			rotationViewSchema,
			{ pin },
			330_000,
		);
	}
	/** Approves or rejects the deploy job waiting on its GitHub environment, after the PIN. */
	reviewServerDeploy(
		projectId: string,
		repoId: string,
		environment: string,
		body: ReviewServerDeploy,
	): Promise<unknown> {
		return this.call(
			'POST',
			`/api/projects/${projectId}/repos/${repoId}/server-deploy/${environment}/review`,
			okAnswerSchema,
			body,
			60_000,
		);
	}
	/** One environment's Secrets: the API reads the place that environment names in its repository. */
	secrets(
		where: { projectId: string; repositoryId: string; environment: string },
		fresh = false,
	): Promise<SecretsView> {
		const q = new URLSearchParams(where);
		if (fresh) q.set('fresh', '1');
		return this.call('GET', `/api/local/secrets?${q.toString()}`, secretsViewSchema, undefined, 200_000);
	}
	/** The name list's places and the repository it belongs to. */
	secretsPlaces(): Promise<SecretsPlaces> {
		return this.call('GET', '/api/local/secrets/places', secretsPlacesSchema);
	}
	/** Saves a batch of Secrets drafts after one PIN; values travel in this request body only. */
	saveSecrets(body: SaveSecrets): Promise<SaveSecretsResult> {
		return this.call('POST', '/api/local/secrets/save', saveSecretsResultSchema, body, 200_000);
	}
	alerts(): Promise<AlertsView> {
		return this.call('GET', '/api/local/alerts', alertsViewSchema);
	}
	/** The tracing switch on this Mac: its state and which apps are sending. */
	localTracing(): Promise<TracingView> {
		return this.call('GET', '/api/local/tracing', tracingViewSchema, undefined, 60_000);
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
		stages: { from?: PipelineStage; only?: PipelineStage; branch?: string; path?: string } = {},
	): Promise<Job> {
		return this.call('POST', `/api/local/run/${action}`, jobSchema, { pin, ...stages }, 30_000);
	}
	stopJob(id: string, pin: string): Promise<Job> {
		return this.call('POST', `/api/local/jobs/${id}/stop`, jobSchema, { pin });
	}
	/** Whether the GitHub CLI on this Mac is installed and signed in, and as whom. */
	githubStatus(): Promise<GithubStatus> {
		return this.call('GET', '/api/local/github/status', githubStatusSchema);
	}
	/** Connect's check: signed in, still answering, and able to open this repository. */
	githubCheck(repository: string): Promise<GithubCheck> {
		return this.call(
			'GET',
			`/api/local/github/check?repository=${encodeURIComponent(repository)}`,
			githubCheckSchema,
			undefined,
			40_000,
		);
	}
	/** Starts the GitHub CLI's browser sign-in where the console runs; its lines are read like any job's. */
	githubLogin(repository: string, mode: 'login' | 'another' | 'packages' = 'login'): Promise<Job> {
		return this.call('POST', '/api/local/github/login', jobSchema, { repository, mode });
	}
	/** Connect's second way in: the token goes to gh on the console's machine and is kept nowhere. */
	githubLoginToken(token: string): Promise<GithubTokenLoginResult> {
		return this.call('POST', '/api/local/github/login-token', githubTokenLoginResultSchema, { token }, 50_000);
	}
	/** Answers the Connect terminal's yes/no question (an update). */
	answerGithubLogin(id: string, answer: 'yes' | 'no'): Promise<Job> {
		return this.call('POST', `/api/local/github/login/${id}/answer`, jobSchema, { answer });
	}
	stopGithubLogin(id: string): Promise<Job> {
		return this.call('POST', `/api/local/github/login/${id}/stop`, jobSchema, {});
	}

	/* local stack (this computer) */
	localServices(repo: string): Promise<ServicesSnapshot> {
		return this.call('GET', `/api/local/services?repo=${encodeURIComponent(repo)}`, servicesSnapshotSchema);
	}
	localReadiness(repo: string): Promise<Readiness> {
		return this.call('GET', `/api/local/readiness?repo=${encodeURIComponent(repo)}`, readinessSchema);
	}
}

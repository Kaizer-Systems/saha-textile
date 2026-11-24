import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
	type CloudVendor,
	type EdgeVendor,
	type SecretsVendor,
	type Branch,
	type Branches,
	type NewProject,
	type SourceCodeVendor,
	VENDOR_NAMES,
	newProjectSchema,
	formatSecretsPlace,
	parseSecretsPlace,
	vendorScreens,
} from '@saha-textile/release-console-contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { PageHead } from './page-head';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { CONSOLE_MENU } from '../menu/console-menu.data';
import { BranchPicker } from '../shared/branch-picker';
import { GithubSignIn } from '../shared/github-sign-in';
import { Icon } from '../shared/icons';
import { STEP_ICONS, VendorLogo } from '../shared/vendor-logo';

export const STEPS = [
	'Name and workspace',
	'Repositories',
	'Environments',
	'Cloud platforms',
	'Edge and DNS',
	'Secrets managers',
	'Project menus',
	'Done',
];
export const SOURCE: SourceCodeVendor[] = ['github', 'gitlab', 'bitbucket', 'azure-repos'];
export const CLOUDS: CloudVendor[] = ['digitalocean', 'aws', 'gcp', 'azure'];
export const EDGES: EdgeVendor[] = ['cloudflare', 'cloudfront', 'fastly'];
export const SECRETS: SecretsVendor[] = [
	'infisical',
	'infisical-self-hosted',
	'aws-secrets-manager',
	'gcp-secret-manager',
	'azure-key-vault',
	'doppler',
	'vault',
	'github-secrets',
	'server-files',
];
export const SECRETS_NOTES: Record<SecretsVendor, string> = {
	infisical: 'managed service; projects, environments and folders',
	'infisical-self-hosted': 'runs on your own server; the same projects and folders',
	'aws-secrets-manager': 'managed by AWS; read with a cloud role',
	'gcp-secret-manager': 'managed by Google Cloud; read with a service account',
	'azure-key-vault': 'managed by Azure; read with a managed identity',
	doppler: 'managed service; projects and configs',
	vault: 'runs on your own server (or HCP Vault)',
	'github-secrets': 'repository and environment secrets for workflows',
	'server-files': 'files kept on the server, written at deploy',
};
/** Self-hosted managers that need their server's address. */
export const needsAddress = (v: SecretsVendor): boolean => v === 'infisical-self-hosted' || v === 'vault';
/** What each manager's "where inside it" box takes, as its placeholder. Infisical's is checked; the rest come with their screens. */
export const PLACE_HINTS: Record<SecretsVendor, string> = {
	infisical: 'project/environment, e.g. saha-textile-local/Development',
	'infisical-self-hosted': 'project/environment, e.g. shop-dev/Development',
	'aws-secrets-manager': 'secret name or prefix, e.g. shop/prod/',
	'gcp-secret-manager': 'project id/prefix, e.g. shop-prod/api-',
	'azure-key-vault': 'vault name, e.g. shop-prod-vault',
	doppler: 'project/config, e.g. shop/prd',
	vault: 'mount/path, e.g. secret/shop/prod',
	'github-secrets': 'GitHub environment, e.g. production',
	'server-files': 'folder on the server, e.g. /srv/shop/env',
};
const isInfisical = (v: SecretsVendor): boolean => v === 'infisical' || v === 'infisical-self-hosted';

/** Under the place box: what an Infisical place reads, in words, or how to write one. */
export function placeNote(vendor: SecretsVendor, text: string): string {
	if (!isInfisical(vendor)) return 'Its screens come later; the console keeps this place for them.';
	const place = parseSecretsPlace(text);
	if (!place)
		return 'Whole environment: saha-textile-local/Development (or its short name, saha-textile-local/dev). One folder: saha-textile-local/Development/api.';
	// A place always has a project and an environment part, so the second piece is always there.
	const typed = (text.split(/[/·|]/)[1] as string).trim();
	const env =
		typed.toLowerCase() === place.environment ? place.environment : `${typed} (short name ${place.environment})`;
	return `Reads project ${place.project}, environment ${env}, ${
		place.folder === '/' ? 'every folder' : `only ${place.folder}`
	}. Saved as ${formatSecretsPlace(place)}.`;
}

/** The place as saved: an Infisical place in its short form (`saha-textile-local/dev`), anything else as typed. */
export function savedPlace(vendor: SecretsVendor | null, text: string): string {
	if (!vendor) return '';
	const place = isInfisical(vendor) ? parseSecretsPlace(text) : null;
	return place ? formatSecretsPlace(place) : text.trim();
}

/** Words or commas: `a.com, b.com` → `['a.com', 'b.com']`. */
export const splitList = (text: string): string[] =>
	text
		.split(/[\s,]+/)
		.map((t) => t.trim())
		.filter(Boolean);
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export const isDomain = (text: string): boolean => DOMAIN.test(text);
/** `Staging`, `Staging and Production`, `Local, Staging and Production`. */
export const andList = (items: string[]): string =>
	items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

interface EnvRule {
	label: string;
	runsOn: CloudVendor | null;
	domains: string;
	secretsFrom: SecretsVendor | 'none' | null;
	secretsPath: string;
}

/** Environments: at least one, and each with at least one domain name (owner, 20 Nov: Next waits for it). */
export function envProblem(envs: EnvRule[]): string {
	if (!envs.length) return 'Keep at least one environment.';
	for (const e of envs) {
		const domains = splitList(e.domains);
		if (!domains.length)
			return `Give ${e.label} at least one domain, such as shop.example.com (localhost on this computer).`;
		const bad = domains.find((d) => !isDomain(d));
		if (bad) return `“${bad}” in ${e.label} is not a domain name.`;
	}
	return '';
}

/**
 * Edge and DNS: environments on a server need an edge platform; each chosen edge needs the domain
 * it holds; each server environment's domains must sit under one of those domains.
 */
export function edgeProblem(envs: EnvRule[], edges: { vendor: EdgeVendor; zones: string }[]): string {
	const onServer = envs.filter((e) => e.runsOn !== null);
	if (onServer.length && !edges.length)
		return `${andList(onServer.map((e) => e.label))} run on a server: choose the edge platform that holds their domains.`;
	const zones: string[] = [];
	for (const edge of edges) {
		const own = splitList(edge.zones);
		if (!own.length) return `Write the domain ${VENDOR_NAMES[edge.vendor]} holds, such as example.com.`;
		const bad = own.find((z) => !isDomain(z));
		if (bad) return `“${bad}” is not a domain name.`;
		zones.push(...own.map((z) => z.toLowerCase()));
	}
	for (const e of onServer)
		for (const d of splitList(e.domains).map((x) => x.toLowerCase()))
			if (!zones.some((z) => d === z || d.endsWith(`.${z}`)))
				return `${d} (${e.label}) is under none of the edge domains.`;
	return '';
}

/** The branch an environment most likely deploys from: a first suggestion, shown for the owner to check. */
export function suggestBranch(env: { name: string; runsOn: CloudVendor | null }, list: Branches): string {
	const has = (n: string | null | undefined): n is string => !!n && list.branches.some((b) => b.name === n);
	if (env.runsOn === null && has(list.current)) return list.current;
	const name = env.name.toLowerCase();
	if (/^(prod|production|live|main)$/.test(name)) return has(list.defaultBranch) ? list.defaultBranch : '';
	const guesses: Record<string, string[]> = {
		staging: ['staging', 'stage'],
		development: ['dev', 'develop', 'development'],
		dev: ['dev', 'develop', 'development'],
	};
	for (const g of [name, ...(guesses[name] ?? [])]) if (has(g)) return g;
	return env.runsOn === null && has(list.defaultBranch) ? list.defaultBranch : '';
}

/** Environments: a branch per GitHub repository, chosen from that repository's list, once it is connected. */
export function branchProblem(
	envs: { label: string; branches: Record<string, string> }[],
	repos: { repository: string; connected: boolean }[],
	lists: Record<string, Branches | undefined>,
): string {
	for (const r of repos) {
		if (!r.connected) return `Connect ${r.repository} on Repositories to choose its branches.`;
		const list = lists[r.repository];
		if (!list) return `Reading ${r.repository}'s branches…`;
		if (!list.branches.length) return list.note || `${r.repository} has no branches to choose from.`;
		for (const e of envs) {
			const b = e.branches[r.repository];
			if (!b) return `Choose ${e.label}'s branch.`;
			if (!list.branches.some((x) => x.name === b)) return `${b} is no longer a branch of ${r.repository}.`;
		}
	}
	return '';
}

/** Secrets: each environment names its manager and where inside it, or says it uses no manager. */
export function secretsProblem(envs: EnvRule[], managers: { vendor: SecretsVendor; address: string }[]): string {
	const noAddress = managers.find((x) => needsAddress(x.vendor) && !/^https?:\/\/\S+$/.test(x.address));
	if (noAddress) return `Give ${VENDOR_NAMES[noAddress.vendor]} its server's address, starting with https://.`;
	for (const e of envs) {
		const from = e.secretsFrom;
		if (from === null || (from !== 'none' && !managers.some((m) => m.vendor === from)))
			return `Choose where ${e.label} reads its secrets: a manager ticked on the left, or no manager.`;
		if (from === 'none') continue;
		const path = e.secretsPath.trim();
		if (!path)
			return `Write where ${e.label} reads inside ${VENDOR_NAMES[from]}: ${PLACE_HINTS[from].replace(/^.*e\.g\. /, 'for example ')}.`;
		if (isInfisical(from) && !parseSecretsPlace(path))
			return `${e.label}: write the place as project/environment, or project/environment/folder.`;
	}
	return '';
}
export const SOURCE_NOTES: Record<SourceCodeVendor, string> = {
	github: 'pull requests, Actions, environments, packages',
	gitlab: 'merge requests, GitLab CI',
	bitbucket: 'pull requests, Pipelines',
	'azure-repos': 'pull requests, Azure Pipelines',
};
/** Own menus a repository can list in its `.release-console.json`. */
// The console's own menu file always has its Shop group.
export const OWN_MENUS = (
	CONSOLE_MENU.menu.find((g) => g.label === 'Shop') as (typeof CONSOLE_MENU.menu)[number]
).subs.flatMap((s) => s.items);

export const slugOf = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);

interface RepoDraft {
	vendor: SourceCodeVendor;
	repository: string;
	role: string;
	menus: string[];
	/** What reading the repository's `.release-console.json` found. */
	file: string;
	/** Connect's state for a GitHub repository: not tried, being checked, connected (as whom), or failed (why). */
	link: 'idle' | 'checking' | 'connected' | 'failed';
	linkNote: string;
	/** GitHub's own name for it when that differs (renamed or moved), offered in the row. */
	renamedTo: string;
}
interface EnvDraft {
	name: string;
	label: string;
	runsOn: CloudVendor | null;
	domains: string;
	/** A manager ticked on the left, `none` for env files written by hand, or null while not chosen yet. */
	secretsFrom: SecretsVendor | 'none' | null;
	secretsPath: string;
	/** Its branch per GitHub repository (`owner/name` → branch); missing until chosen. */
	branches: Record<string, string>;
}

/** Add a project: name, repositories (a vendor each), environments, clouds, edges, own menus. */
@Component({
	selector: 'rc-add-project',
	imports: [PageHead, VendorLogo, Icon, GithubSignIn, BranchPicker],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<rc-page-head
			crumb="Add a project ›"
			[title]="'Add a project · ' + steps[at()]"
		/>
		<div class="rc-content">
			<ol class="do-steps">
				@for (s of steps; track s) {
					<li
						[class.done]="$index < at()"
						[class.on]="$index === at()"
					>
						<span>{{ $index + 1 }}</span>
						<rc-icon
							[name]="stepIcons[$index] ?? 'tabler/circle'"
							flush
						/>
						{{ s }}
					</li>
				}
			</ol>
			@switch (at()) {
				@case (0) {
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/folder" />
									Name
								</span>
							</div>
							<div class="rc-form">
								<label>
									Project
									<div class="rc-msearch">
										<input
											type="text"
											autocomplete="off"
											[value]="name()"
											(input)="name.set($any($event.target).value)"
										/>
									</div>
								</label>
								<label>
									Id
									<span class="rc-select">{{ id() || '—' }}</span>
								</label>
							</div>
							<p class="rc-note">
								Keys are linked per project on its Connections tab, so a key never serves another
								project by accident.
							</p>
						</div>
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/briefcase" />
									Workspace
								</span>
							</div>
							<div class="pj-vendors">
								@for (ws of workspaces(); track ws) {
									<div
										class="do-radio"
										role="radio"
										tabindex="0"
										[class.on]="workspace() === ws"
										(click)="workspace.set(ws)"
										(keydown.enter)="workspace.set(ws)"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>{{ ws }}</b>
											<small>existing workspace</small>
										</span>
									</div>
								}
							</div>
							<div class="rc-form">
								<label>
									New
									<div class="rc-msearch">
										<input
											type="text"
											autocomplete="off"
											placeholder="Clients, Personal…"
											(input)="workspace.set($any($event.target).value)"
										/>
									</div>
								</label>
							</div>
						</div>
					</div>
				}
				@case (1) {
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/square-rounded-plus" />
									Add a repository · one source-code vendor per repository
								</span>
							</div>
							<div class="pj-vendors">
								@for (v of source; track v) {
									<div
										class="pj-vendor"
										role="radio"
										tabindex="0"
										[class.on]="repoVendor() === v"
										(click)="repoVendor.set(v)"
										(keydown.enter)="repoVendor.set(v)"
									>
										<b>
											<rc-vendor-logo [vendor]="v" />
										</b>
										<small>{{ sourceNotes[v] }}</small>
										@if (repoVendor() === v) {
											<span class="rc-pill ok">chosen</span>
										} @else if (screens(v) === 'later') {
											<span class="rc-pill amber">screens later</span>
										} @else {
											<span class="rc-pill muted">choose</span>
										}
									</div>
								}
							</div>
							<div class="rc-form">
								<label>
									owner/name
									<div class="rc-msearch">
										<input
											#repoName
											type="text"
											autocomplete="off"
											placeholder="Kaizer-Systems/shop-web"
										/>
									</div>
								</label>
								<label>
									Role
									<div class="rc-msearch">
										<input
											#repoRole
											type="text"
											autocomplete="off"
											placeholder="storefront, API, admin…"
										/>
									</div>
								</label>
							</div>
							<div>
								<button
									type="button"
									class="rc-btn"
									(click)="addRepo(repoName, repoRole)"
								>
									+ Add repository
								</button>
							</div>
							<p class="rc-note">
								Each repository signs in on its own, on the Connections screen after the project is
								added.
							</p>
						</div>
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/brand-git" />
									Repositories in this project
								</span>
							</div>
							@if (notice()) {
								<div class="rc-banner red small">
									<span class="rc-dot red"></span>
									<div>
										<b>{{ notice() }}</b>
										Press Connect to try again.
									</div>
									<button
										type="button"
										class="rc-btn ghost"
										(click)="notice.set('')"
									>
										Dismiss
									</button>
								</div>
							}
							<div class="rc-tw">
								<table class="rc-t">
									<thead>
										<tr>
											<th>Vendor</th>
											<th>Repository</th>
											<th>Connection</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										@for (r of repos(); track r.repository) {
											<tr>
												<td>
													<rc-vendor-logo
														[vendor]="r.vendor"
														[size]="14"
													/>
												</td>
												<td>
													<div class="rc-mono">{{ r.repository }}</div>
													@if (r.role) {
														<div class="rc-note">{{ r.role }}</div>
													}
													<div class="rc-note">Own menus: {{ r.file }}</div>
												</td>
												<td>
													@if (r.vendor === 'github') {
														<div class="rc-form">
															@switch (r.link) {
																@case ('connected') {
																	<span class="rc-pill ok">
																		connected as {{ r.linkNote }}
																	</span>
																	@if (r.renamedTo) {
																		<div class="rc-note">
																			GitHub now calls it {{ r.renamedTo }}.
																		</div>
																		<button
																			type="button"
																			class="rc-btn ghost"
																			(click)="
																				useNewName(r.repository, r.renamedTo)
																			"
																		>
																			Use {{ r.renamedTo }}
																		</button>
																	}
																}
																@case ('checking') {
																	<span class="rc-pill cy">connecting…</span>
																}
																@case ('failed') {
																	<div class="rc-note red">{{ r.linkNote }}</div>
																	<div class="rc-states">
																		<button
																			type="button"
																			class="rc-btn"
																			(click)="connect(r.repository, 'another')"
																		>
																			<rc-icon name="tabler/plug-connected" />
																			Use another account
																		</button>
																		<button
																			type="button"
																			class="rc-btn ghost"
																			(click)="connect(r.repository)"
																		>
																			Check again
																		</button>
																	</div>
																}
																@default {
																	<div>
																		<button
																			type="button"
																			class="rc-btn"
																			(click)="connect(r.repository)"
																		>
																			<rc-icon name="tabler/plug-connected" />
																			Connect
																		</button>
																	</div>
																}
															}
														</div>
													} @else {
														<span class="rc-note">on Connections, once added</span>
													}
												</td>
												<td>
													<button
														type="button"
														class="rc-btn ghost"
														(click)="dropRepo(r.repository)"
													>
														Remove
													</button>
												</td>
											</tr>
										} @empty {
											<tr><td colspan="4">None yet.</td></tr>
										}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				}
				@case (2) {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/stack-2" />
								Environments and where each runs · every repository of the project
							</span>
						</div>
						<div class="rc-tw">
							<table class="rc-t">
								<thead>
									<tr>
										<th>Environment</th>
										<th>Runs on</th>
										<th>Branch</th>
										<th>Domains</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									@for (e of envs(); track e.name; let i = $index) {
										<tr>
											<td>
												<b>{{ e.label }}</b>
												<br />
												<span class="rc-mono">{{ e.name }}</span>
											</td>
											<td>
												<div class="rc-states">
													<button
														type="button"
														class="rc-chip"
														[class.on]="e.runsOn === null"
														(click)="setRunsOn(i, null)"
													>
														this computer
													</button>
													@for (c of clouds; track c) {
														<button
															type="button"
															class="rc-chip"
															[class.on]="e.runsOn === c"
															(click)="setRunsOn(i, c)"
														>
															<rc-vendor-logo
																[vendor]="c"
																[size]="14"
															/>
														</button>
													}
												</div>
											</td>
											<td>
												<!-- Each environment's branch per GitHub repository (owner, 20 Nov). -->
												@for (r of githubRepos(); track r.repository) {
													<rc-branch-picker
														[label]="
															githubRepos().length > 1 ? shortName(r.repository) : ''
														"
														[context]="e.label"
														[branches]="branchesOf(r.repository)"
														[defaultBranch]="listOf(r.repository)?.defaultBranch ?? null"
														[current]="listOf(r.repository)?.current ?? null"
														[value]="e.branches[r.repository] ?? ''"
														[waitingText]="waitingFor(r.repository)"
														[refreshing]="refreshing().has(r.repository)"
														(picked)="setBranch(i, r.repository, $event)"
														(refresh)="loadBranches(r.repository, true)"
													/>
												} @empty {
													<span class="rc-note">the repository's default branch</span>
												}
											</td>
											<td>
												<div class="rc-msearch">
													<input
														type="text"
														autocomplete="off"
														[value]="e.domains"
														placeholder="shop.example.com, admin.example.com"
														(input)="setDomains(i, $any($event.target).value)"
													/>
												</div>
											</td>
											<td>
												<button
													type="button"
													class="rc-btn ghost"
													(click)="dropEnv(i)"
												>
													Remove
												</button>
											</td>
										</tr>
									}
								</tbody>
							</table>
						</div>
						<div class="rc-form">
							<label>
								Add
								<div class="rc-msearch">
									<input
										#envName
										type="text"
										autocomplete="off"
										placeholder="preview, qa, demo…"
									/>
								</div>
							</label>
						</div>
						<div>
							<button
								type="button"
								class="rc-btn"
								(click)="addEnv(envName)"
							>
								+ Add environment
							</button>
						</div>
					</div>
				}
				@case (3) {
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/cloud" />
									Cloud platforms · one or more (multi-cloud)
								</span>
							</div>
							<div class="pj-vendors">
								@for (c of clouds; track c) {
									<div
										class="pj-vendor"
										role="checkbox"
										tabindex="0"
										[class.on]="cloudSet().has(c)"
										(click)="toggleCloud(c)"
										(keydown.enter)="toggleCloud(c)"
									>
										<b>
											<rc-vendor-logo [vendor]="c" />
										</b>
										<small>
											@if (usedBy(c); as who) {
												{{ who }} {{ who.includes(' and ') ? 'run' : 'runs' }} here
											} @else {
												{{
													screens(c) === 'full'
														? 'full console screens today'
														: 'connect now; screens come later'
												}}
											}
										</small>
										<span
											class="rc-pill"
											[class.ok]="cloudSet().has(c)"
											[class.amber]="!cloudSet().has(c) && screens(c) === 'later'"
											[class.muted]="!cloudSet().has(c) && screens(c) === 'full'"
										>
											{{
												cloudSet().has(c)
													? 'active'
													: screens(c) === 'later'
														? 'screens later'
														: 'choose'
											}}
										</span>
									</div>
								}
							</div>
						</div>
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/key" />
									Keys
								</span>
							</div>
							<p class="rc-p">
								Keys are added on the project's Connections screen after this wizard: a token paste, a
								browser sign-in, or a cloud role, never a password. A cloud an environment runs on is
								ticked by itself and stays ticked until that environment moves (on Environments). Tick
								another only if the project uses it without an environment, for storage say.
							</p>
						</div>
					</div>
				}
				@case (4) {
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/world" />
									Edge, DNS and security · one or more
								</span>
							</div>
							<div class="pj-vendors">
								@for (v of edges; track v) {
									<div
										class="pj-vendor"
										role="checkbox"
										tabindex="0"
										[class.on]="edgeOn(v)"
										(click)="toggleEdge(v)"
										(keydown.enter)="toggleEdge(v)"
									>
										<b>
											<rc-vendor-logo [vendor]="v" />
										</b>
										<small>
											{{
												v === 'cloudflare'
													? 'DNS, SSL, WAF, cache, tunnels, Access'
													: v === 'fastly'
														? 'CDN and WAF'
														: 'CDN and DNS on AWS'
											}}
										</small>
										<span
											class="rc-pill"
											[class.ok]="edgeOn(v)"
											[class.amber]="!edgeOn(v) && screens(v) === 'later'"
											[class.muted]="!edgeOn(v) && screens(v) === 'full'"
										>
											{{
												edgeOn(v)
													? 'active'
													: screens(v) === 'later'
														? 'screens later'
														: 'choose'
											}}
										</span>
									</div>
								}
							</div>
						</div>
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/world-www" />
									Each domain belongs to one edge platform
								</span>
							</div>
							<div class="rc-form">
								@for (e of edgeList(); track e.vendor; let i = $index) {
									<label>
										<rc-vendor-logo
											[vendor]="e.vendor"
											[size]="16"
										/>
										<div class="rc-msearch">
											<input
												type="text"
												autocomplete="off"
												[value]="e.zones"
												placeholder="example.com"
												(input)="setZones(i, $any($event.target).value)"
											/>
										</div>
									</label>
								} @empty {
									<p class="rc-note">No edge platform chosen.</p>
								}
							</div>
						</div>
					</div>
				}
				@case (5) {
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/key" />
									Secrets managers · one or more
								</span>
							</div>
							<div class="pj-vendors">
								@for (v of secretsVendors; track v) {
									<div
										class="pj-vendor"
										role="checkbox"
										tabindex="0"
										[class.on]="secretsOn(v)"
										[attr.aria-checked]="secretsOn(v)"
										(click)="toggleSecrets(v)"
										(keydown.enter)="toggleSecrets(v)"
									>
										<b>
											<rc-vendor-logo [vendor]="v" />
										</b>
										<small>{{ secretsNotes[v] }}</small>
										<span
											class="rc-pill"
											[class.ok]="secretsOn(v)"
											[class.amber]="!secretsOn(v) && screens(v) === 'later'"
											[class.muted]="!secretsOn(v) && screens(v) === 'full'"
										>
											{{
												secretsOn(v)
													? 'active'
													: screens(v) === 'later'
														? 'screens later'
														: 'choose'
											}}
										</span>
									</div>
								}
							</div>
							<div class="rc-form">
								@for (x of secretsList(); track x.vendor; let i = $index) {
									@if (addressNeeded(x.vendor)) {
										<label>
											<rc-vendor-logo
												[vendor]="x.vendor"
												[size]="16"
											/>
											<div class="rc-msearch">
												<input
													type="url"
													autocomplete="off"
													placeholder="https://secrets.example.com"
													[value]="x.address"
													(input)="setSecretsAddress(i, $any($event.target).value)"
												/>
											</div>
										</label>
									}
								}
							</div>
							<p class="rc-note">
								A project can use several: for example one manager for the apps and GitHub's own secrets
								for its workflows. Keys to read them are added on the Connections tab.
							</p>
						</div>
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/route" />
									Where each environment reads its secrets
								</span>
							</div>
							<div class="rc-tw">
								<table class="rc-t">
									<thead>
										<tr>
											<th>Environment</th>
											<th>Reads from, and where inside it</th>
										</tr>
									</thead>
									<tbody>
										@for (e of envs(); track e.name; let i = $index) {
											<tr>
												<td>
													<b>{{ e.label }}</b>
												</td>
												<td>
													<div class="rc-form">
														<div class="rc-states">
															@for (x of secretsList(); track x.vendor) {
																<button
																	type="button"
																	class="rc-chip"
																	[class.on]="e.secretsFrom === x.vendor"
																	(click)="setSecretsFrom(i, x.vendor)"
																>
																	<rc-vendor-logo
																		[vendor]="x.vendor"
																		[size]="14"
																	/>
																</button>
															}
															<button
																type="button"
																class="rc-chip"
																[class.on]="e.secretsFrom === 'none'"
																(click)="setSecretsFrom(i, 'none')"
															>
																no manager
															</button>
														</div>
														@if (managerOf(e); as v) {
															<div class="rc-msearch">
																<input
																	type="text"
																	autocomplete="off"
																	spellcheck="false"
																	[attr.aria-label]="e.label + ' reads from'"
																	[placeholder]="placeHints[v]"
																	[value]="e.secretsPath"
																	(input)="
																		setSecretsPath(i, $any($event.target).value)
																	"
																/>
															</div>
															<p class="rc-note">{{ placeNote(v, e.secretsPath) }}</p>
														} @else if (e.secretsFrom === 'none') {
															<p class="rc-note">
																The console reads no secrets for {{ e.label }}: its apps
																read env files written by hand, outside the console.
															</p>
														} @else {
															<p class="rc-note">
																{{
																	secretsList().length
																		? 'Choose a manager ticked on the left, or no manager.'
																		: 'Tick a manager on the left first, or choose no manager.'
																}}
															</p>
														}
													</div>
												</td>
											</tr>
										}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				}
				@case (6) {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/list-details" />
								Project menus · each repository's own screens
							</span>
						</div>
						@for (r of repos(); track r.repository) {
							<span class="rc-subl">{{ r.repository }}</span>
							<div class="pj-grid">
								@for (m of ownMenus; track m) {
									<div
										class="do-radio"
										role="checkbox"
										tabindex="0"
										[class.on]="r.menus.includes(m)"
										(click)="toggleMenu(r.repository, m)"
										(keydown.enter)="toggleMenu(r.repository, m)"
									>
										<i aria-hidden="true"></i>
										<span>
											<b>{{ menuLabel(m) }}</b>
											<small>{{ menuCaption(m) }}</small>
										</span>
									</div>
								}
							</div>
						}
						<p class="rc-note">
							A repository can also list these in its own
							<code>.release-console.json</code>
							.
						</p>
					</div>
				}
				@default {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/circle-check" />
								Ready to add
							</span>
						</div>
						<div class="rc-tw">
							<table class="rc-t">
								<tbody>
									<tr>
										<td>Project</td>
										<td>{{ name() }} · {{ workspace() }}</td>
									</tr>
									<tr>
										<td>Repositories</td>
										<td>
											<div class="rc-form">
												@for (r of repos(); track r.repository) {
													<div class="rc-states">
														<rc-vendor-logo
															[vendor]="r.vendor"
															[size]="14"
														/>
														<span class="rc-mono">{{ r.repository }}</span>
													</div>
												}
											</div>
										</td>
									</tr>
									<tr>
										<td>Environments</td>
										<td>
											<div class="rc-form">
												@for (e of envs(); track e.name) {
													<div class="rc-states">
														<b>{{ e.label }}</b>
														@if (e.runsOn) {
															<rc-vendor-logo
																[vendor]="e.runsOn"
																[size]="14"
															/>
														} @else {
															<span>this computer</span>
														}
														@for (r of githubRepos(); track r.repository) {
															<rc-icon name="tabler/git-branch" />
															<span class="rc-mono">
																{{ e.branches[r.repository] || 'default branch' }}
															</span>
														}
													</div>
												}
											</div>
										</td>
									</tr>
									<tr>
										<td>Clouds</td>
										<td>
											<div class="rc-states">
												@for (c of cloudSet(); track c) {
													<rc-vendor-logo
														[vendor]="c"
														[size]="14"
													/>
												} @empty {
													<span>—</span>
												}
											</div>
										</td>
									</tr>
									<tr>
										<td>Edges</td>
										<td>
											<div class="rc-form">
												@for (e of edgeList(); track e.vendor) {
													<div class="rc-states">
														<rc-vendor-logo
															[vendor]="e.vendor"
															[size]="14"
														/>
														<span class="rc-mono">{{ e.zones }}</span>
													</div>
												} @empty {
													<span>—</span>
												}
											</div>
										</td>
									</tr>
									<tr>
										<td>Secrets</td>
										<td>
											<div class="rc-states">
												@for (x of secretsList(); track x.vendor) {
													<rc-vendor-logo
														[vendor]="x.vendor"
														[size]="14"
													/>
												} @empty {
													<span>no manager</span>
												}
											</div>
										</td>
									</tr>
									<tr>
										<td>Each environment reads</td>
										<td>
											<div class="rc-form">
												@for (e of envs(); track e.name) {
													<div class="rc-states">
														<b>{{ e.label }}</b>
														@if (managerOf(e); as v) {
															<rc-vendor-logo
																[vendor]="v"
																[size]="14"
															/>
															<span class="rc-mono">{{ e.secretsPath }}</span>
														} @else {
															<span>no manager</span>
														}
													</div>
												}
											</div>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<p class="rc-note">Next: connect each vendor on the project's Connections screen.</p>
					</div>
				}
			}
			@if (message()) {
				<p class="rc-note red">{{ message() }}</p>
			}
			<div class="rc-row between do-nav">
				<button
					type="button"
					class="rc-btn ghost"
					(click)="back()"
				>
					{{ at() ? '‹ Back' : 'Cancel' }}
				</button>
				<!-- Why Next waits sits between the buttons, so they never move when it clears. -->
				@if (problem(); as why) {
					<span class="rc-note">{{ why }}</span>
				}
				<button
					type="button"
					class="rc-btn primary"
					[disabled]="busy() || !!problem()"
					(click)="next()"
				>
					{{ nextLabel() }}
				</button>
			</div>
		</div>
		@if (showSignIn()) {
			<rc-github-sign-in
				[repository]="pending() ?? ''"
				[mode]="signInMode()"
				(signedIn)="afterSignIn()"
				(closed)="afterClose($event)"
			/>
		}
	`,
})
export class AddProject {
	private readonly api = inject(ConsoleApi);
	private readonly router = inject(Router);
	private readonly queries = inject(QueryClient);
	private readonly ctx = inject(ConsoleContext);
	protected readonly steps = STEPS;
	protected readonly stepIcons = STEP_ICONS;
	protected readonly names = VENDOR_NAMES;
	protected readonly source = SOURCE;
	protected readonly sourceNotes = SOURCE_NOTES;
	protected readonly clouds = CLOUDS;
	protected readonly edges = EDGES;
	protected readonly secretsVendors = SECRETS;
	protected readonly secretsNotes = SECRETS_NOTES;
	protected readonly addressNeeded = needsAddress;
	protected readonly placeHints = PLACE_HINTS;
	protected readonly placeNote = placeNote;
	protected readonly ownMenus = OWN_MENUS;
	protected readonly screens = vendorScreens;

	protected readonly at = signal(0);
	protected readonly busy = signal(false);
	protected readonly message = signal('');
	/** The terminal popup that connects GitHub where the console runs. */
	protected readonly showSignIn = signal(false);
	/** The repository whose Connect opened the popup. */
	protected readonly pending = signal<string | null>(null);
	/** login: the usual Connect; another: sign in a second GitHub account (the row's Use another account). */
	protected readonly signInMode = signal<'login' | 'another'>('login');
	/** A page-level notice, e.g. a connection closed before it finished. */
	protected readonly notice = signal('');

	private setLink(repository: string, link: RepoDraft['link'], linkNote = '', renamedTo = ''): void {
		this.repos.update((rs) =>
			rs.map((r) => (r.repository === repository ? { ...r, link, linkNote, renamedTo } : r)),
		);
	}

	/** Takes GitHub's new name for a renamed or moved repository and reads its menus again. */
	protected useNewName(old: string, name: string): void {
		this.repos.update((rs) =>
			rs.map((r) => (r.repository === old ? { ...r, repository: name, renamedTo: '', file: 'reading…' } : r)),
		);
		void this.readFile(name);
	}

	/**
	 * Connect (owner, 20 Nov: "let the terminal pop-up always be there"): the terminal popup opens on
	 * every press and runs the steps in front of you: Git's and gh's update checks, then the saved
	 * sign-in named, or a new sign-in. Use another account signs in a second account the same way.
	 */
	protected connect(repository: string, mode: 'login' | 'another' = 'login'): void {
		this.notice.set('');
		this.pending.set(repository);
		this.signInMode.set(mode);
		this.setLink(repository, 'checking');
		this.showSignIn.set(true);
	}

	/**
	 * After the terminal signs in: whether the sign-in still answers and can open this repository.
	 * Green when it can; otherwise the row says why (another account, or Check again once access
	 * is granted on GitHub).
	 */
	private async check(repository: string): Promise<void> {
		try {
			const c = await this.api.githubCheck(repository);
			if (c.signedIn && c.account && c.reachable) {
				const renamed = c.fullName && c.fullName.toLowerCase() !== repository.toLowerCase() ? c.fullName : '';
				this.setLink(repository, 'connected', c.account, renamed);
				const branch = this.menusBranch(repository);
				void this.readFile(repository, branch || undefined);
				void this.loadBranches(repository);
			} else this.setLink(repository, 'failed', c.message || 'GitHub did not answer as signed in.');
		} catch (err) {
			this.setLink(repository, 'failed', (err as Error).message);
		}
	}

	/** The popup closed: before the connection finished, the page says it was cancelled. */
	protected afterClose(connected: boolean): void {
		this.showSignIn.set(false);
		const repository = this.pending();
		if (!connected && repository) {
			this.setLink(repository, 'idle');
			this.notice.set('GitHub connection cancelled.');
		}
		this.pending.set(null);
	}

	/** Signed in in the terminal: the page checks the repository at once and turns it green. */
	protected async afterSignIn(): Promise<void> {
		const repository = this.pending();
		if (repository) await this.check(repository);
	}
	protected readonly name = signal('');
	protected readonly workspace = signal('');
	protected readonly id = computed(() => slugOf(this.name()));
	protected readonly repoVendor = signal<SourceCodeVendor>('github');
	protected readonly repos = signal<RepoDraft[]>([]);
	protected readonly envs = signal<EnvDraft[]>([
		{
			name: 'local',
			label: 'Local',
			runsOn: null,
			domains: 'localhost',
			secretsFrom: null,
			secretsPath: '',
			branches: {},
		},
		{
			name: 'staging',
			label: 'Staging',
			runsOn: 'digitalocean',
			domains: '',
			secretsFrom: null,
			secretsPath: '',
			branches: {},
		},
		{
			name: 'production',
			label: 'Production',
			runsOn: 'digitalocean',
			domains: '',
			secretsFrom: null,
			secretsPath: '',
			branches: {},
		},
	]);
	/** Clouds ticked by hand that no environment runs on (storage, say). */
	protected readonly extraClouds = signal<Set<CloudVendor>>(new Set());
	/** Ticked clouds: every cloud an environment runs on, plus the ones ticked by hand (owner, 20 Nov). */
	protected readonly cloudSet = computed(
		() =>
			new Set<CloudVendor>([...this.envs().flatMap((e) => (e.runsOn ? [e.runsOn] : [])), ...this.extraClouds()]),
	);
	protected readonly secretsList = signal<{ vendor: SecretsVendor; address: string }[]>([]);
	protected readonly edgeList = signal<{ vendor: EdgeVendor; zones: string }[]>([
		{ vendor: 'cloudflare', zones: '' },
	]);
	/** Each GitHub repository's branches, once read (owner, 20 Nov: a branch per environment). */
	protected readonly lists = signal<Record<string, Branches>>({});
	protected readonly refreshing = signal<Set<string>>(new Set());
	protected readonly githubRepos = computed(() => this.repos().filter((r) => r.vendor === 'github'));
	protected shortName(repository: string): string {
		// Every repository here was added as owner/name (addRepo) or renamed to GitHub's owner/name.
		return repository.split('/')[1] as string;
	}
	protected listOf(repository: string): Branches | undefined {
		return this.lists()[repository];
	}
	protected branchesOf(repository: string): Branch[] {
		return this.lists()[repository]?.branches ?? [];
	}
	protected waitingFor(repository: string): string {
		if (this.repos().find((r) => r.repository === repository)?.link !== 'connected')
			return 'Connect it on Repositories first';
		if (this.refreshing().has(repository)) return 'fetching branches…';
		return this.lists()[repository]?.note || 'loading branches…';
	}
	/** The branch the menus file is read from: the first environment on this computer's, else the first one's. */
	private menusBranch(repository: string): string {
		const es = this.envs();
		return (es.find((e) => e.runsOn === null) ?? es[0])?.branches[repository] ?? '';
	}
	/**
	 * Reads a connected repository's branches (refresh: git fetch on this computer first), suggests a
	 * branch for each environment that has none yet, and reads the menus file from the Local branch.
	 */
	protected async loadBranches(repository: string, refresh = false): Promise<void> {
		if (this.repos().find((r) => r.repository === repository)?.link !== 'connected') return;
		this.refreshing.update((set) => new Set([...set, repository]));
		try {
			const list = await this.api.repositoryBranches(repository, refresh);
			this.lists.update((m) => ({ ...m, [repository]: list }));
			const before = this.menusBranch(repository);
			this.envs.update((es) =>
				es.map((e) =>
					e.branches[repository]
						? e
						: { ...e, branches: { ...e.branches, [repository]: suggestBranch(e, list) } },
				),
			);
			const after = this.menusBranch(repository);
			if (after && after !== before) void this.readFile(repository, after);
		} catch (err) {
			this.lists.update((m) => ({
				...m,
				[repository]: { defaultBranch: null, current: null, branches: [], note: (err as Error).message },
			}));
		} finally {
			this.refreshing.update((set) => new Set([...set].filter((x) => x !== repository)));
		}
	}
	protected setBranch(i: number, repository: string, branch: string): void {
		const before = this.menusBranch(repository);
		this.envs.update((es) =>
			es.map((e, n) => (n === i ? { ...e, branches: { ...e.branches, [repository]: branch } } : e)),
		);
		const after = this.menusBranch(repository);
		if (after && after !== before) void this.readFile(repository, after);
	}
	protected readonly workspaces = computed(() => this.ctx.projects.data()?.workspaces ?? []);

	protected readonly nextLabel = computed(() =>
		this.at() === STEPS.length - 1 ? 'Add project' : `Next: ${(STEPS[this.at() + 1] ?? '').toLowerCase()} ›`,
	);

	protected menuLabel(key: string): string {
		return CONSOLE_MENU.screens[key]?.label ?? key;
	}
	protected menuCaption(key: string): string {
		return Object.values(CONSOLE_MENU.screens[key]?.captions ?? {})[0] ?? '';
	}
	protected addRepo(box: HTMLInputElement, role: HTMLInputElement): void {
		const repository = box.value.trim();
		if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
			this.message.set('Write the repository as owner/name.');
			return;
		}
		if (this.repos().some((r) => r.repository === repository)) return;
		const vendor = this.repoVendor();
		this.repos.update((rs) => [
			...rs,
			{
				vendor,
				repository,
				role: role.value.trim(),
				menus: [],
				// Read only once Connect has signed in (owner, 20 Nov: "only after the connection is successful").
				file: vendor === 'github' ? 'read after Connect' : 'tick them on Project menus',
				link: 'idle',
				linkNote: '',
				renamedTo: '',
			},
		]);
		box.value = '';
		role.value = '';
		this.message.set('');
	}

	/**
	 * Prefills the repository's own menus from its `.release-console.json` on the default branch, read
	 * through the sign-in Connect just checked. Present: its menus are ticked on Project menus.
	 * Absent: nothing is ticked there, and the menus are ticked by hand; the project ends the same.
	 */
	private async readFile(repository: string, ref?: string): Promise<void> {
		const set = (file: string, menus?: string[]) =>
			this.repos.update((rs) =>
				rs.map((r) => (r.repository !== repository ? r : { ...r, file, menus: menus ?? r.menus })),
			);
		set('reading…');
		try {
			const a = await this.api.repositoryFile({ vendor: 'github', repository, ...(ref ? { ref } : {}) });
			const on = ref ? `on ${ref}` : 'on the default branch';
			if (a.state === 'not-connected') set('Connect to read them.');
			else if (a.state !== 'ok') set(a.message);
			else if (!a.data.found) set(`no .release-console.json ${on}; tick them on Project menus`);
			else {
				const menus = a.data.menus.filter((m) => !!CONSOLE_MENU.screens[m]);
				// Version 2 tells more than menus (brief 26gq3NbcbBESea6abRtsa3): its parts, and lines it could not use.
				const parts = a.data.manifest?.parts.length ?? 0;
				const skipped = a.data.problems.length;
				set(
					`from .release-console.json ${on}: ${menus.map((m) => this.menuLabel(m)).join(', ') || 'none'}` +
						(parts ? ` · ${parts} parts described` : '') +
						(skipped ? ` · ${skipped} line(s) not used: ${a.data.problems.join(' ')}` : ''),
					menus,
				);
			}
		} catch (err) {
			set((err as Error).message);
		}
	}
	protected dropRepo(repository: string): void {
		this.repos.update((rs) => rs.filter((r) => r.repository !== repository));
	}
	protected setRunsOn(i: number, cloud: CloudVendor | null): void {
		this.envs.update((es) => es.map((e, n) => (n === i ? { ...e, runsOn: cloud } : e)));
	}
	/** The environments that run on a cloud, in words, or '' when none does. */
	protected usedBy(c: CloudVendor): string {
		return andList(
			this.envs()
				.filter((e) => e.runsOn === c)
				.map((e) => e.label),
		);
	}
	protected setDomains(i: number, domains: string): void {
		this.envs.update((es) => es.map((e, n) => (n === i ? { ...e, domains } : e)));
	}
	protected addEnv(box: HTMLInputElement): void {
		const label = box.value.trim();
		const name = slugOf(label);
		if (!name || this.envs().some((e) => e.name === name)) return;
		this.envs.update((es) => [
			...es,
			{ name, label, runsOn: null, domains: '', secretsFrom: null, secretsPath: '', branches: {} },
		]);
		box.value = '';
	}
	protected dropEnv(i: number): void {
		this.envs.update((es) => es.filter((_, n) => n !== i));
	}
	protected toggleCloud(c: CloudVendor): void {
		const who = this.usedBy(c);
		if (who) {
			const many = who.includes(' and ');
			this.message.set(
				`${who} ${many ? 'run' : 'runs'} on ${VENDOR_NAMES[c]}. Move ${many ? 'them' : 'it'} on Environments first.`,
			);
			return;
		}
		this.message.set('');
		const next = new Set(this.extraClouds());
		if (next.has(c)) next.delete(c);
		else next.add(c);
		this.extraClouds.set(next);
	}
	protected edgeOn(v: EdgeVendor): boolean {
		return this.edgeList().some((e) => e.vendor === v);
	}
	protected toggleEdge(v: EdgeVendor): void {
		this.edgeList.update((list) =>
			list.some((e) => e.vendor === v) ? list.filter((e) => e.vendor !== v) : [...list, { vendor: v, zones: '' }],
		);
	}
	protected setZones(i: number, zones: string): void {
		this.edgeList.update((list) => list.map((e, n) => (n === i ? { ...e, zones } : e)));
	}
	protected secretsOn(v: SecretsVendor): boolean {
		return this.secretsList().some((x) => x.vendor === v);
	}
	protected toggleSecrets(v: SecretsVendor): void {
		if (this.secretsOn(v)) {
			this.secretsList.update((list) => list.filter((x) => x.vendor !== v));
			this.envs.update((es) =>
				es.map((e) => (e.secretsFrom === v ? { ...e, secretsFrom: null, secretsPath: '' } : e)),
			);
		} else this.secretsList.update((list) => [...list, { vendor: v, address: '' }]);
	}
	protected setSecretsAddress(i: number, address: string): void {
		this.secretsList.update((list) => list.map((x, n) => (n === i ? { ...x, address: address.trim() } : x)));
	}
	protected setSecretsFrom(i: number, from: SecretsVendor | 'none'): void {
		this.envs.update((es) =>
			es.map((e, n) =>
				n === i ? { ...e, secretsFrom: from, secretsPath: from === 'none' ? '' : e.secretsPath } : e,
			),
		);
	}
	/** The manager an environment reads, or null for no manager or not chosen yet. */
	protected managerOf(e: EnvDraft): SecretsVendor | null {
		return e.secretsFrom && e.secretsFrom !== 'none' ? e.secretsFrom : null;
	}
	protected setSecretsPath(i: number, secretsPath: string): void {
		this.envs.update((es) => es.map((e, n) => (n === i ? { ...e, secretsPath } : e)));
	}
	protected toggleMenu(repository: string, menu: string): void {
		this.repos.update((rs) =>
			rs.map((r) =>
				r.repository !== repository
					? r
					: { ...r, menus: r.menus.includes(menu) ? r.menus.filter((m) => m !== menu) : [...r.menus, menu] },
			),
		);
	}

	/** The wizard's answers as the API's NewProject. */
	protected draft(): NewProject {
		const list = (text: string) =>
			text
				.split(/[\s,]+/)
				.map((t) => t.trim())
				.filter(Boolean);
		const clouds = [...this.cloudSet()];
		const secrets = this.secretsList().map((x) => x.vendor);
		return {
			id: this.id(),
			name: this.name().trim(),
			workspace: this.workspace().trim(),
			repositories: this.repos().map((r) => {
				const short = this.shortName(r.repository);
				return {
					id: slugOf(short),
					name: short,
					role: r.role,
					sourceCode: { vendor: r.vendor, repository: r.repository, keyId: null },
					environments: this.envs().map((e) => ({
						name: e.name,
						label: e.label,
						cloudId: e.runsOn && clouds.includes(e.runsOn) ? e.runsOn : null,
						domains: list(e.domains),
						secretsId: (() => {
							const v = this.managerOf(e);
							return v && secrets.includes(v) ? v : null;
						})(),
						secretsPath: savedPlace(this.managerOf(e), e.secretsPath),
						branch: e.branches[r.repository] ?? '',
					})),
					cloud: clouds.map((c) => ({ id: c, vendor: c, account: '', keyIds: [] })),
					edge: this.edgeList().map((e) => ({
						id: e.vendor,
						vendor: e.vendor,
						account: '',
						zones: list(e.zones),
						keyIds: [],
					})),
					secrets: this.secretsList().map((x) => ({
						id: x.vendor,
						vendor: x.vendor,
						address: needsAddress(x.vendor) ? x.address : '',
						keyIds: [],
					})),
					menus: r.menus,
				};
			}),
		};
	}

	/** Why Next waits on this step, live (owner, 20 Nov: Next stays off until the step is complete). */
	protected readonly problem = computed(() => this.stepError());

	private stepError(): string {
		switch (this.at()) {
			case 0:
				if (!this.id()) return 'Give the project a name.';
				if (!/^[\p{L}\p{N} &().,'_-]+$/u.test(this.name().trim()))
					return "Use letters, digits, spaces and & ( ) . , ' _ - in the name.";
				if (this.ctx.projects.data()?.projects.some((p) => p.id === this.id()))
					return 'A project with that name exists.';
				return this.workspace().trim() ? '' : 'Choose or name a workspace.';
			case 1:
				return this.repos().length ? '' : 'Add at least one repository.';
			case 2:
				return (
					envProblem(this.envs()) ||
					branchProblem(
						this.envs(),
						this.githubRepos().map((r) => ({
							repository: r.repository,
							connected: r.link === 'connected',
						})),
						this.lists(),
					)
				);
			case 4:
				return edgeProblem(this.envs(), this.edgeList());
			case 5:
				return secretsProblem(this.envs(), this.secretsList());
			default:
				return '';
		}
	}

	protected back(): void {
		this.message.set('');
		if (this.at()) this.at.update((n) => n - 1);
		else void this.router.navigate(['/console', 'projects']);
	}

	/**
	 * When the GitHub CLI is signed in, the new project's GitHub repositories read GitHub through it:
	 * the sign-in is linked as the project's key and set on each GitHub repository's source code.
	 * A failure here leaves the repositories for the Connections screen, which opens next.
	 */
	private async linkCliSignIn(projectId: string): Promise<void> {
		const github = this.repos().filter((r) => r.vendor === 'github' && r.link === 'connected');
		if (!github.length) return;
		try {
			await this.api.linkKey(projectId, {
				id: 'github-cli',
				kind: 'github-cli',
				label: 'GitHub CLI sign-in on this computer',
				envNames: [],
				expiresAt: null,
				note: '',
				target: '',
			});
			for (const r of github) {
				const short = this.shortName(r.repository);
				await this.api.setSlotKeys(projectId, {
					repositoryId: slugOf(short),
					slot: 'source-code',
					slotId: '',
					keyIds: ['github-cli'],
				});
			}
		} catch {
			// Connections shows the repository without a key, with its Link a key button.
		}
	}

	protected async next(): Promise<void> {
		const error = this.stepError();
		this.message.set(error);
		if (error) return;
		if (this.at() < STEPS.length - 1) {
			this.at.update((n) => n + 1);
			return;
		}
		const parsed = newProjectSchema.safeParse(this.draft());
		if (!parsed.success) {
			this.message.set(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
			return;
		}
		this.busy.set(true);
		try {
			const project = await this.api.addProject(parsed.data);
			await this.linkCliSignIn(project.id);
			await this.queries.invalidateQueries({ queryKey: ['projects'] });
			void this.router.navigate(['/p', project.id, 'settings'], { queryParams: { tab: 'connections' } });
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}
}

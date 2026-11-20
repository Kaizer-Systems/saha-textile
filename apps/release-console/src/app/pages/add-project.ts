import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
	type CloudVendor,
	type EdgeVendor,
	type SecretsVendor,
	type NewProject,
	type SourceCodeVendor,
	VENDOR_NAMES,
	newProjectSchema,
	vendorScreens,
} from '@saha-textile/release-console-contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { PageHead } from './page-head';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { CONSOLE_MENU } from '../menu/console-menu.data';
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
export const SOURCE_NOTES: Record<SourceCodeVendor, string> = {
	github: 'pull requests, Actions, environments, packages',
	gitlab: 'merge requests, GitLab CI',
	bitbucket: 'pull requests, Pipelines',
	'azure-repos': 'pull requests, Azure Pipelines',
};
/** Own menus a repository can list in its `.release-console.json`. */
export const OWN_MENUS = CONSOLE_MENU.menu.find((g) => g.label === 'Shop')?.subs.flatMap((s) => s.items) ?? [];

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
	secretsFrom: SecretsVendor | null;
	secretsPath: string;
}

/** Add a project: name, repositories (a vendor each), environments, clouds, edges, own menus. */
@Component({
	selector: 'rc-add-project',
	imports: [PageHead, VendorLogo, Icon, GithubSignIn],
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
											<th>Repository</th>
											<th>Vendor</th>
											<th>Role</th>
											<th>Own menus</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										@for (r of repos(); track r.repository) {
											<tr>
												<td class="rc-mono">{{ r.repository }}</td>
												<td>
													<rc-vendor-logo
														[vendor]="r.vendor"
														[size]="16"
													/>
												</td>
												<td>{{ r.role || '—' }}</td>
												<td>
													<div class="rc-mono">{{ r.file }}</div>
													@if (r.vendor === 'github') {
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
																		(click)="useNewName(r.repository, r.renamedTo)"
																	>
																		Use {{ r.renamedTo }}
																	</button>
																}
															}
															@case ('checking') {
																<span class="rc-pill cy">checking…</span>
															}
															@case ('failed') {
																<div class="rc-note red">{{ r.linkNote }}</div>
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
															}
															@default {
																<button
																	type="button"
																	class="rc-btn"
																	(click)="connect(r.repository)"
																>
																	<rc-icon name="tabler/plug-connected" />
																	Connect
																</button>
															}
														}
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
											<tr><td colspan="5">None yet.</td></tr>
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
											{{
												screens(c) === 'full'
													? 'full console screens today'
													: 'connect now; screens come later'
											}}
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
								browser sign-in, or a cloud role, never a password. Environments that run on a cloud are
								ticked here already.
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
															<button
																type="button"
																class="rc-chip"
																[class.on]="e.secretsFrom === null"
																(click)="setSecretsFrom(i, null)"
															>
																files kept by hand
															</button>
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
														</div>
														<div class="rc-msearch">
															<input
																type="text"
																autocomplete="off"
																placeholder="project · environment · /folder"
																[value]="e.secretsPath"
																[disabled]="e.secretsFrom === null"
																(input)="setSecretsPath(i, $any($event.target).value)"
															/>
														</div>
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
													<span>files kept by hand</span>
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
														@if (e.secretsFrom) {
															<rc-vendor-logo
																[vendor]="e.secretsFrom"
																[size]="14"
															/>
															<span class="rc-mono">{{ e.secretsPath }}</span>
														} @else {
															<span>files kept by hand</span>
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
				<button
					type="button"
					class="rc-btn primary"
					[disabled]="busy()"
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
	 * Connect (owner, 20 Nov): first checks, with no terminal, that a sign-in exists where the console
	 * runs, that it still answers, and that it can open this repository; then the row turns green.
	 * Otherwise the terminal popup opens and starts the sign-in by itself. A sign-in that answers but
	 * cannot open the repository is said in the row: signing in again would not change that.
	 */
	protected async connect(repository: string, mode: 'login' | 'another' = 'login'): Promise<void> {
		this.notice.set('');
		if (mode === 'another') {
			this.pending.set(repository);
			this.signInMode.set('another');
			this.setLink(repository, 'checking');
			this.showSignIn.set(true);
			return;
		}
		this.signInMode.set('login');
		this.setLink(repository, 'checking');
		try {
			const c = await this.api.githubCheck(repository);
			if (c.signedIn && c.account && c.reachable) {
				const renamed = c.fullName && c.fullName.toLowerCase() !== repository.toLowerCase() ? c.fullName : '';
				this.setLink(repository, 'connected', c.account, renamed);
				void this.readFile(repository);
				return;
			}
			if (c.signedIn && c.account) {
				this.setLink(repository, 'failed', c.message);
				return;
			}
		} catch (err) {
			this.setLink(repository, 'failed', (err as Error).message);
			return;
		}
		this.pending.set(repository);
		this.showSignIn.set(true);
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

	/** Connected in the terminal: the page checks the repository again at once and turns it green. */
	protected async afterSignIn(): Promise<void> {
		const repository = this.pending();
		if (repository) await this.connect(repository);
	}
	protected readonly name = signal('');
	protected readonly workspace = signal('');
	protected readonly id = computed(() => slugOf(this.name()));
	protected readonly repoVendor = signal<SourceCodeVendor>('github');
	protected readonly repos = signal<RepoDraft[]>([]);
	protected readonly envs = signal<EnvDraft[]>([
		{ name: 'local', label: 'Local', runsOn: null, domains: 'localhost', secretsFrom: null, secretsPath: '' },
		{ name: 'staging', label: 'Staging', runsOn: 'digitalocean', domains: '', secretsFrom: null, secretsPath: '' },
		{
			name: 'production',
			label: 'Production',
			runsOn: 'digitalocean',
			domains: '',
			secretsFrom: null,
			secretsPath: '',
		},
	]);
	protected readonly cloudSet = signal<Set<CloudVendor>>(new Set(['digitalocean']));
	protected readonly secretsList = signal<{ vendor: SecretsVendor; address: string }[]>([]);
	protected readonly edgeList = signal<{ vendor: EdgeVendor; zones: string }[]>([
		{ vendor: 'cloudflare', zones: '' },
	]);
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
				file: vendor === 'github' ? 'reading…' : 'add menus by hand',
				link: 'idle',
				linkNote: '',
				renamedTo: '',
			},
		]);
		box.value = '';
		role.value = '';
		this.message.set('');
		if (vendor === 'github') void this.readFile(repository);
	}

	/** Prefills the repository's own menus from its `.release-console.json`, read through the GitHub CLI sign-in. */
	private async readFile(repository: string): Promise<void> {
		const set = (file: string, menus?: string[]) =>
			this.repos.update((rs) =>
				rs.map((r) => (r.repository !== repository ? r : { ...r, file, menus: menus ?? r.menus })),
			);
		try {
			const a = await this.api.repositoryFile({ vendor: 'github', repository });
			if (a.state === 'not-connected') set('Connect to read its own menus.');
			else if (a.state !== 'ok') set(a.message);
			else if (!a.data.found) set('no .release-console.json');
			else {
				const menus = a.data.menus.filter((m) => !!CONSOLE_MENU.screens[m]);
				set(
					`menus from .release-console.json: ${menus.map((m) => this.menuLabel(m)).join(', ') || 'none'}`,
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
		if (cloud) this.cloudSet.update((s) => new Set([...s, cloud]));
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
			{ name, label, runsOn: null, domains: '', secretsFrom: null, secretsPath: '' },
		]);
		box.value = '';
	}
	protected dropEnv(i: number): void {
		this.envs.update((es) => es.filter((_, n) => n !== i));
	}
	protected toggleCloud(c: CloudVendor): void {
		const next = new Set(this.cloudSet());
		if (next.has(c)) next.delete(c);
		else next.add(c);
		this.cloudSet.set(next);
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
	protected setSecretsFrom(i: number, vendor: SecretsVendor | null): void {
		this.envs.update((es) =>
			es.map((e, n) => (n === i ? { ...e, secretsFrom: vendor, secretsPath: vendor ? e.secretsPath : '' } : e)),
		);
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
				const short = r.repository.split('/')[1] ?? r.repository;
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
						secretsId: e.secretsFrom && secrets.includes(e.secretsFrom) ? e.secretsFrom : null,
						secretsPath: e.secretsFrom ? e.secretsPath.trim() : '',
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
				return this.envs().length ? '' : 'Keep at least one environment.';
			case 5: {
				const missing = this.secretsList().find(
					(x) => needsAddress(x.vendor) && !/^https?:\/\/\S+$/.test(x.address),
				);
				return missing
					? `Give ${VENDOR_NAMES[missing.vendor]} its server's address, starting with https://.`
					: '';
			}
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
				const short = r.repository.split('/')[1] ?? r.repository;
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

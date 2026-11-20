import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { VENDOR_NAMES, type Repository } from '@saha-textile/release-console-contracts';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';

import { Connections } from './connections';
import { when } from './format-time';
import { PageHead } from './page-head';
import { RepoCi } from './repo-ci';
import { RepositoryEditor } from './repository-editor';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { CONSOLE_MENU } from '../menu/console-menu.data';
import { PROJECT_PAGES, SETTINGS_TABS } from '../shell/shell';

/** The project level: every repository at a glance, environments, Attention, Audit and settings. */
@Component({
	selector: 'rc-project-page',
	imports: [PageHead, Connections, RepoCi, NgTemplateOutlet, RepositoryEditor],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (ctx.project(); as p) {
			<rc-page-head
				[crumb]="p.name + ' ›'"
				[title]="title()"
				[tabs]="page() === 'settings' ? settingsTabs : []"
				[tab]="settingsTab()"
			/>
			<div class="rc-content">
				@switch (page()) {
					@case ('repositories') {
						<ng-container *ngTemplateOutlet="repoTable" />
					}
					@case ('environments') {
						<ng-container *ngTemplateOutlet="envTable" />
					}
					@case ('attention') {
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">What needs you in {{ p.name }}</span>
							</div>
							@if (attention.isPending()) {
								<p class="rc-p muted">Checking keys and pipelines…</p>
							} @else {
								<div class="rc-tw">
									<table class="rc-t">
										<thead>
											<tr>
												<th>What</th>
												<th>Repository</th>
												<th>Detail</th>
											</tr>
										</thead>
										<tbody>
											@for (a of attention.data() ?? []; track $index) {
												<tr>
													<td>
														<span
															class="rc-dot"
															[class.red]="
																a.kind === 'key-expired' ||
																a.kind === 'key-failed' ||
																a.kind === 'ci-failed'
															"
															[class.amber]="
																a.kind === 'key-expiring' ||
																a.kind === 'approval-waiting' ||
																a.kind === 'key-missing'
															"
														></span>
														<b>{{ a.title }}</b>
													</td>
													<td>{{ a.repositoryId ?? 'project' }}</td>
													<td>
														@if (a.detail.startsWith('https://')) {
															<a
																class="rc-mono"
																[href]="a.detail"
																target="_blank"
																rel="noopener"
															>
																open on GitHub ↗
															</a>
														} @else {
															{{ a.detail }}
														}
													</td>
												</tr>
											} @empty {
												<tr><td colspan="3">Nothing needs you.</td></tr>
											}
										</tbody>
									</table>
								</div>
							}
						</div>
					}
					@case ('audit') {
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">{{ p.name }} · who did what, newest first</span>
							</div>
							<div class="rc-tw">
								<table class="rc-t">
									<thead>
										<tr>
											<th>When</th>
											<th>Action</th>
											<th>Detail</th>
										</tr>
									</thead>
									<tbody>
										@for (e of audit.data() ?? []; track $index) {
											<tr>
												<td class="rc-mono">{{ when(e.at) }}</td>
												<td class="rc-mono">{{ e.action }}</td>
												<td>{{ e.detail }}</td>
											</tr>
										}
									</tbody>
								</table>
							</div>
						</div>
					}
					@case ('settings') {
						@switch (settingsTab()) {
							@case ('repositories') {
								<rc-repository-editor
									[project]="p"
									[open]="repo()"
								/>
							}
							@case ('environments') {
								<ng-container *ngTemplateOutlet="envTable" />
							}
							@case ('menus') {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">
											Each repository's own menus · from its .release-console.json
										</span>
									</div>
									<div class="rc-tw">
										<table class="rc-t">
											<thead>
												<tr>
													<th>Repository</th>
													<th>Own menus</th>
												</tr>
											</thead>
											<tbody>
												@for (r of p.repositories; track r.id) {
													<tr>
														<td>
															<b>{{ r.name }}</b>
														</td>
														<td>{{ menusOf(r) }}</td>
													</tr>
												}
											</tbody>
										</table>
									</div>
									<p class="rc-note">
										A repository's own menus appear as the first group of its menu, labelled with
										its name.
									</p>
								</div>
							}
							@case ('remove') {
								<form
									class="rc-panel"
									(submit)="remove($event, typed.value)"
								>
									<div class="rc-ph">
										<span class="rc-label">Remove {{ p.name }}</span>
									</div>
									<p class="rc-p">
										This removes the project from this console and deletes its
										{{ p.keys.length }} key{{ p.keys.length === 1 ? '' : 's' }} from the Keychain.
										No other project is touched, and nothing changes on GitHub or any cloud.
									</p>
									<div class="rc-form">
										<label>
											Type “{{ p.name }}”
											<div class="rc-msearch">
												<input
													#typed
													type="text"
													autocomplete="off"
												/>
											</div>
										</label>
									</div>
									@if (removeMessage()) {
										<p class="rc-note">{{ removeMessage() }}</p>
									}
									<div>
										<button
											type="submit"
											class="rc-btn danger"
										>
											Remove project
										</button>
									</div>
								</form>
							}
							@default {
								<rc-connections [project]="p" />
							}
						}
					}
					@default {
						<div class="rc-g3">
							@for (r of p.repositories; track r.id) {
								<div class="rc-panel">
									<div class="rc-ph">
										<span class="rc-label">{{ r.name }}</span>
									</div>
									<div class="rc-kv">
										<div>
											<span>Is</span>
											<em>{{ r.role || '—' }}</em>
										</div>
										<div>
											<span>Source code</span>
											<em>{{ vendor(r.sourceCode.vendor) }} · {{ r.sourceCode.repository }}</em>
										</div>
										<div>
											<span>Runs on</span>
											<em>{{ cloudsOf(r) }}</em>
										</div>
										<div>
											<span>Edge</span>
											<em>{{ edgesOf(r) }}</em>
										</div>
										<rc-repo-ci
											[projectId]="p.id"
											[repo]="r"
										/>
									</div>
									<div>
										<button
											type="button"
											class="rc-btn ghost"
											(click)="openRepo(r.id)"
										>
											Open repository ›
										</button>
									</div>
								</div>
							}
						</div>
					}
				}
			</div>

			<ng-template #repoTable>
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">Repositories · one source-code vendor each</span></div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Repository</th>
									<th>Source code</th>
									<th>Environments</th>
									<th>Clouds</th>
									<th>Edges</th>
									<th>Secrets</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								@for (r of p.repositories; track r.id) {
									<tr>
										<td>
											<b>{{ r.name }}</b>
											<br />
											<span class="rc-mono">{{ r.role }}</span>
										</td>
										<td>
											{{ vendor(r.sourceCode.vendor) }} ·
											<span class="rc-mono">{{ r.sourceCode.repository }}</span>
										</td>
										<td>{{ envLabels(r) }}</td>
										<td>{{ cloudsOf(r) }}</td>
										<td>{{ edgesOf(r) }}</td>
										<td>{{ secretsOf(r) }}</td>
										<td>
											<button
												type="button"
												class="rc-btn ghost"
												(click)="openRepo(r.id)"
											>
												Open ›
											</button>
										</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			</ng-template>
			<ng-template #envTable>
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">Environments and where each runs</span></div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Environment</th>
									<th>Repository</th>
									<th>Runs on</th>
									<th>Domains</th>
									<th>Secrets from</th>
								</tr>
							</thead>
							<tbody>
								@for (row of envRows(); track row.repo + row.env) {
									<tr>
										<td>
											<b>{{ row.label }}</b>
										</td>
										<td>{{ row.repo }}</td>
										<td>{{ row.runsOn }}</td>
										<td class="rc-mono">{{ row.domains }}</td>
										<td>{{ row.secrets }}</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
				</div>
			</ng-template>
		} @else if (ctx.projects.isSuccess()) {
			<rc-page-head title="No such project" />
			<div class="rc-content">
				<p class="rc-p muted">This project is not in the console. Choose one from the Project switcher.</p>
			</div>
		}
	`,
})
export class ProjectPage {
	private readonly router = inject(Router);
	private readonly api = inject(ConsoleApi);
	private readonly queries = inject(QueryClient);
	protected readonly ctx = inject(ConsoleContext);
	readonly page = input('overview');
	readonly tab = input<string | undefined>(undefined);
	/** The repository opened from its menu's Repository settings. */
	readonly repo = input<string | undefined>(undefined);
	protected readonly when = when;
	protected readonly settingsTabs = SETTINGS_TABS;
	protected readonly removeMessage = signal('');

	protected readonly title = computed(() => {
		if (this.page() === 'settings')
			return SETTINGS_TABS.find(([k]) => k === this.settingsTab())?.[1] ?? 'Connections';
		if (this.page() === 'overview') return 'Project overview';
		return PROJECT_PAGES.find(([k]) => k === this.page())?.[1] ?? 'Project overview';
	});
	protected readonly settingsTab = computed(() => {
		const t = this.tab();
		return SETTINGS_TABS.some(([k]) => k === t) ? (t ?? 'connections') : 'connections';
	});

	protected readonly attention = injectQuery(() => ({
		queryKey: ['attention', this.ctx.projectId()],
		queryFn: () => this.api.attention(this.ctx.projectId() ?? ''),
		enabled: this.page() === 'attention' && !!this.ctx.projectId(),
	}));
	protected readonly audit = injectQuery(() => ({
		queryKey: ['audit', this.ctx.projectId()],
		queryFn: () => this.api.audit(this.ctx.projectId()),
		enabled: this.page() === 'audit' && !!this.ctx.projectId(),
	}));

	protected readonly envRows = computed(() =>
		(this.ctx.project()?.repositories ?? []).flatMap((r) =>
			r.environments.map((e) => {
				const cloud = r.cloud.find((c) => c.id === e.cloudId);
				const secrets = r.secrets.find((x) => x.id === e.secretsId);
				return {
					repo: r.name,
					env: e.name,
					label: e.label,
					runsOn: cloud ? VENDOR_NAMES[cloud.vendor] : 'this computer',
					domains: e.domains.join(', ') || '—',
					secrets: secrets
						? `${VENDOR_NAMES[secrets.vendor]}${e.secretsPath ? ` · ${e.secretsPath}` : ''}`
						: 'files kept by hand',
				};
			}),
		),
	);

	protected vendor(v: keyof typeof VENDOR_NAMES): string {
		return VENDOR_NAMES[v];
	}
	protected cloudsOf(r: Repository): string {
		return r.cloud.map((c) => VENDOR_NAMES[c.vendor]).join(' + ') || 'this computer only';
	}
	protected edgesOf(r: Repository): string {
		return (
			r.edge
				.map((e) => `${VENDOR_NAMES[e.vendor]}${e.zones.length ? ` (${e.zones.join(', ')})` : ''}`)
				.join(' + ') || '—'
		);
	}
	protected secretsOf(r: Repository): string {
		return r.secrets.map((x) => VENDOR_NAMES[x.vendor]).join(' + ') || 'files kept by hand';
	}
	protected envLabels(r: Repository): string {
		return r.environments.map((e) => e.label).join(' · ');
	}
	protected menusOf(r: Repository): string {
		return r.menus.map((k) => CONSOLE_MENU.screens[k]?.label ?? k).join(', ') || 'none';
	}
	protected openRepo(repoId: string): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'r', repoId, 'overview']);
	}
	protected async remove(e: Event, typed: string): Promise<void> {
		e.preventDefault();
		const p = this.ctx.project();
		if (!p) return;
		if (typed.trim() !== p.name) {
			this.removeMessage.set(`Type the project name exactly: ${p.name}`);
			return;
		}
		try {
			await this.api.removeProject(p.id);
			await this.queries.invalidateQueries({ queryKey: ['projects'] });
			void this.router.navigate(['/console', 'projects']);
		} catch (err) {
			this.removeMessage.set((err as Error).message);
		}
	}
}

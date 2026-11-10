import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { VENDOR_NAMES, type Project } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AddProject } from './add-project';
import { when } from './format-time';
import { PageHead } from './page-head';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

/** The console level: all projects by workspace, Add a project, Attention, Audit and Console settings. */
@Component({
	selector: 'rc-console-page',
	imports: [PageHead, AddProject],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@switch (page()) {
			@case ('add') {
				<rc-add-project />
			}
			@case ('attention') {
				<rc-page-head title="Attention" />
				<div class="rc-content">
					<div class="rc-panel">
						<div class="rc-ph"><span class="rc-label">What needs you · names and counts only</span></div>
						@if (counts.isPending()) {
							<p class="rc-p muted">Asking each project…</p>
						} @else {
							<div class="rc-tw">
								<table class="rc-t">
									<thead>
										<tr>
											<th>Project</th>
											<th>Needs you</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										@for (c of counts.data() ?? []; track c.projectId) {
											<tr>
												<td>
													<b>{{ c.name }}</b>
												</td>
												<td>
													<span
														class="rc-pill"
														[class.ok]="!c.count"
														[class.amber]="c.count > 0"
													>
														{{ c.count ? c.count + ' items' : 'nothing' }}
													</span>
												</td>
												<td>
													<button
														type="button"
														class="rc-btn ghost"
														(click)="open(c.projectId, 'attention')"
													>
														Open ›
													</button>
												</td>
											</tr>
										}
									</tbody>
								</table>
							</div>
						}
						<p class="rc-note">
							The console level never shows a project's data; open the project to see what each item is.
						</p>
					</div>
				</div>
			}
			@case ('audit') {
				<rc-page-head title="Audit (every project)" />
				<div class="rc-content">
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">Who did what, newest first · this computer</span>
						</div>
						<div class="rc-tw">
							<table class="rc-t">
								<thead>
									<tr>
										<th>When</th>
										<th>Project</th>
										<th>Action</th>
										<th>Detail</th>
									</tr>
								</thead>
								<tbody>
									@for (e of audit.data() ?? []; track $index) {
										<tr>
											<td class="rc-mono">{{ when(e.at) }}</td>
											<td>{{ projectName(e.projectId) }}</td>
											<td class="rc-mono">{{ e.action }}</td>
											<td>{{ e.detail }}</td>
										</tr>
									}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			}
			@case ('settings') {
				<rc-page-head title="Console settings" />
				<div class="rc-content">
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph"><span class="rc-label">Lock</span></div>
							<p class="rc-p">
								The console locks when this tab closes, after 30 idle minutes, and when its local API
								restarts.
							</p>
							<div>
								<button
									type="button"
									class="rc-btn"
									(click)="lockNow()"
								>
									<span
										class="lock"
										aria-hidden="true"
									></span>
									Lock now
								</button>
							</div>
						</div>
						<form
							class="rc-panel"
							(submit)="changePin($event, cur.value, next.value)"
						>
							<div class="rc-ph"><span class="rc-label">Change PIN</span></div>
							<div class="rc-form">
								<label>
									Current PIN
									<div class="rc-msearch">
										<input
											#cur
											type="password"
											inputmode="numeric"
											maxlength="6"
											autocomplete="off"
										/>
									</div>
								</label>
								<label>
									New PIN
									<div class="rc-msearch">
										<input
											#next
											type="password"
											inputmode="numeric"
											maxlength="6"
											autocomplete="off"
										/>
									</div>
								</label>
							</div>
							@if (pinMessage()) {
								<p class="rc-note">{{ pinMessage() }}</p>
							}
							<div>
								<button
									type="submit"
									class="rc-btn primary"
								>
									Change PIN
								</button>
							</div>
						</form>
					</div>
				</div>
			}
			@default {
				<rc-page-head title="All projects" />
				<div class="rc-content">
					<div class="rc-row between">
						<span class="rc-label">
							Choose a project. Environments and every other menu belong to a project.
						</span>
						<button
							type="button"
							class="rc-btn primary"
							(click)="router.navigate(['/console', 'add'])"
						>
							+ Add a project
						</button>
					</div>
					@for (ws of workspaces(); track ws) {
						<div class="pj-ws">
							<span class="rc-subl">{{ ws }}</span>
							<div class="pj-grid">
								@for (p of inWorkspace(ws); track p.id) {
									<div class="rc-panel pj-card">
										<h3 class="rc-h">{{ p.name }}</h3>
										<div class="rc-kv">
											<div>
												<span>Source code</span>
												<em>{{ sourceOf(p) }}</em>
											</div>
											<div>
												<span>Environments</span>
												<em>{{ envsOf(p) }}</em>
											</div>
											<div>
												<span>Cloud</span>
												<em>{{ cloudsOf(p) }}</em>
											</div>
											<div>
												<span>Edge and DNS</span>
												<em>{{ edgesOf(p) }}</em>
											</div>
										</div>
										<div>
											<button
												type="button"
												class="rc-btn ghost"
												(click)="open(p.id, 'overview')"
											>
												Open ›
											</button>
										</div>
									</div>
								}
							</div>
						</div>
					} @empty {
						<p class="rc-p muted">
							No projects yet. Add one, or put a
							<code>.release-console.json</code>
							at the repository root.
						</p>
					}
				</div>
			}
		}
	`,
})
export class ConsolePage {
	protected readonly router = inject(Router);
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	readonly page = input('projects');
	protected readonly when = when;
	protected readonly pinMessage = signal('');

	protected readonly counts = injectQuery(() => ({
		queryKey: ['attention-counts'],
		queryFn: () => this.api.attentionCounts(),
		enabled: this.page() === 'attention',
	}));
	protected readonly audit = injectQuery(() => ({
		queryKey: ['audit', null],
		queryFn: () => this.api.audit(null),
		enabled: this.page() === 'audit',
	}));

	private readonly all = computed(() => this.ctx.projects.data()?.projects ?? []);
	protected readonly workspaces = computed(() => [...new Set(this.all().map((p) => p.workspace))]);
	protected inWorkspace(ws: string): Project[] {
		return this.all().filter((p) => p.workspace === ws);
	}
	protected projectName(id: string | null): string {
		return id ? (this.all().find((p) => p.id === id)?.name ?? id) : 'Console';
	}
	protected sourceOf(p: Project): string {
		const vendors = [...new Set(p.repositories.map((r) => VENDOR_NAMES[r.sourceCode.vendor]))];
		return `${vendors.join(', ')} · ${p.repositories.length} repo${p.repositories.length === 1 ? '' : 's'}`;
	}
	protected envsOf(p: Project): string {
		return [...new Set(p.repositories.flatMap((r) => r.environments.map((e) => e.label)))].join(' · ');
	}
	protected cloudsOf(p: Project): string {
		return (
			[...new Set(p.repositories.flatMap((r) => r.cloud.map((c) => VENDOR_NAMES[c.vendor])))].join(' + ') || '—'
		);
	}
	protected edgesOf(p: Project): string {
		return (
			[...new Set(p.repositories.flatMap((r) => r.edge.map((e) => VENDOR_NAMES[e.vendor])))].join(' + ') || '—'
		);
	}
	protected open(projectId: string, page: string): void {
		void this.router.navigate(['/p', projectId, page]);
	}
	protected lockNow(): void {
		void this.api.lockNow();
	}
	protected async changePin(e: Event, current: string, next: string): Promise<void> {
		e.preventDefault();
		if (!/^\d{6}$/.test(current) || !/^\d{6}$/.test(next)) {
			this.pinMessage.set('Both PINs are 6 digits.');
			return;
		}
		try {
			await this.api.changePin(current, next);
			this.pinMessage.set('PIN changed.');
			(e.target as HTMLFormElement).reset();
		} catch (err) {
			this.pinMessage.set((err as Error).message);
		}
	}
}

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { AddProject } from './add-project';
import { when } from './format-time';
import { PageHead } from './page-head';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { Icon, environmentIcon } from '../shared/icons';
import { VendorLogo } from '../shared/vendor-logo';

import type { Project, Vendor } from '@saha-textile/release-console-contracts';

/** The console level: all projects by workspace, Add a project, Attention, Audit and Console settings. */
@Component({
	selector: 'rc-console-page',
	imports: [PageHead, AddProject, Icon, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@switch (page()) {
			@case ('add') {
				<rc-add-project />
			}
			@case ('attention') {
				<rc-page-head
					title="Attention"
					icon="tabler/bell-ringing"
				/>
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
													<b>
														<rc-icon name="tabler/folder" />
														{{ c.name }}
													</b>
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
				<rc-page-head
					title="Audit (every project)"
					icon="tabler/history"
				/>
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
				<rc-page-head
					title="Console settings"
					icon="tabler/settings"
				/>
				<div class="rc-content">
					<div class="rc-g2">
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/lock" />
									Lock
								</span>
							</div>
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
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/dialpad" />
									Change PIN
								</span>
							</div>
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
					<form
						class="rc-panel"
						(submit)="savePassword($event)"
					>
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/password" />
								Sign in with a PIN or a password
							</span>
						</div>
						@if (lock.data(); as l) {
							<div class="rc-kv">
								<div>
									<span>PIN</span>
									<em class="ok">set</em>
								</div>
								<div>
									<span>Password</span>
									<em [class.ok]="l.passwordSet">{{ l.passwordSet ? 'set' : 'not set' }}</em>
								</div>
								<div>
									<span>The lock screen opens with</span>
									<em>
										{{ l.passwordSet && l.preferred === 'password' ? 'the password' : 'the PIN' }}
									</em>
								</div>
							</div>
							<div class="rc-form">
								<label>
									PIN
									<div class="rc-msearch">
										<input
											#pwPin
											name="pin"
											type="password"
											inputmode="numeric"
											maxlength="6"
											autocomplete="off"
											aria-label="Your PIN, to confirm"
										/>
									</div>
								</label>
								<label>
									{{ l.passwordSet ? 'New password' : 'Password' }}
									<div class="rc-msearch">
										<input
											name="password"
											type="password"
											autocomplete="new-password"
											placeholder="12 or more characters"
										/>
									</div>
								</label>
								<label>
									Again
									<div class="rc-msearch">
										<input
											name="again"
											type="password"
											autocomplete="new-password"
										/>
									</div>
								</label>
							</div>
							<div class="rc-row">
								<button
									type="submit"
									class="rc-btn primary"
								>
									{{ l.passwordSet ? 'Change password' : 'Set password' }}
								</button>
								@if (l.passwordSet) {
									<button
										type="button"
										class="rc-btn"
										[class.on]="l.preferred === 'pin'"
										(click)="choose('pin', pwPin.value)"
									>
										Open with the PIN
									</button>
									<button
										type="button"
										class="rc-btn"
										[class.on]="l.preferred === 'password'"
										(click)="choose('password', pwPin.value)"
									>
										Open with the password
									</button>
									<button
										type="button"
										class="rc-btn danger"
										(click)="removePassword(pwPin.value)"
									>
										Remove password
									</button>
								}
							</div>
							@if (signInMessage()) {
								<p class="rc-note">{{ signInMessage() }}</p>
							}
							<p class="rc-note">
								Both are kept only as one-way hashes in the console's own database. Every change here
								needs your PIN. Wrong tries of either count toward the same 15-minute lock.
							</p>
						}
					</form>
				</div>
			}
			@default {
				<rc-page-head
					title="All projects"
					icon="tabler/layout-grid"
				/>
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
							<rc-icon name="tabler/square-rounded-plus" />
							Add a project
						</button>
					</div>
					@for (ws of workspaces(); track ws) {
						<div class="pj-ws">
							<span class="rc-subl">
								<rc-icon name="tabler/briefcase" />
								{{ ws }}
							</span>
							<div class="pj-grid">
								@for (p of inWorkspace(ws); track p.id) {
									<div class="rc-panel pj-card">
										<h3 class="rc-h">
											<rc-icon name="tabler/folder" />
											{{ p.name }}
										</h3>
										<div class="rc-kv">
											<div>
												<span>Source code</span>
												<em>
													@for (v of sourcesOf(p); track v) {
														<rc-vendor-logo
															[vendor]="v"
															[size]="14"
														/>
													}
													· {{ p.repositories.length }} repo{{
														p.repositories.length === 1 ? '' : 's'
													}}
												</em>
											</div>
											<div>
												<span>Environments</span>
												<em>
													@for (e of envsOf(p); track e.name) {
														<rc-icon [name]="envIcon(e.name, e.local)" />
														{{ e.label }}
													}
												</em>
											</div>
											<div>
												<span>Cloud</span>
												<em>
													@for (c of cloudsOf(p); track c) {
														<rc-vendor-logo
															[vendor]="c"
															[size]="14"
														/>
													} @empty {
														<rc-icon name="tabler/device-laptop" />
														this computer
													}
												</em>
											</div>
											<div>
												<span>Edge and DNS</span>
												<em>
													@for (e of edgesOf(p); track e) {
														<rc-vendor-logo
															[vendor]="e"
															[size]="14"
														/>
													} @empty {
														—
													}
												</em>
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
							No projects yet. Add a project to choose its repositories, environments, cloud and edge
							platforms; then connect each one on its Connections tab.
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
	protected readonly signInMessage = signal('');
	protected readonly lock = injectQuery(() => ({
		queryKey: ['lock-status'],
		queryFn: () => this.api.lockStatus(),
		enabled: this.page() === 'settings',
	}));

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
	protected readonly envIcon = environmentIcon;
	protected sourcesOf(p: Project): Vendor[] {
		return [...new Set(p.repositories.map((r) => r.sourceCode.vendor))];
	}
	protected envsOf(p: Project): { name: string; label: string; local: boolean }[] {
		const seen = new Map<string, { name: string; label: string; local: boolean }>();
		for (const e of p.repositories.flatMap((r) => r.environments))
			if (!seen.has(e.name)) seen.set(e.name, { name: e.name, label: e.label, local: e.cloudId === null });
		return [...seen.values()];
	}
	protected cloudsOf(p: Project): Vendor[] {
		return [...new Set(p.repositories.flatMap((r) => r.cloud.map((c) => c.vendor)))];
	}
	protected edgesOf(p: Project): Vendor[] {
		return [...new Set(p.repositories.flatMap((r) => r.edge.map((e) => e.vendor)))];
	}
	protected open(projectId: string, page: string): void {
		void this.router.navigate(['/p', projectId, page]);
	}
	protected lockNow(): void {
		void this.api.lockNow();
	}
	protected async savePassword(e: Event): Promise<void> {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value ?? '';
		const [pin, password, again] = [field('pin'), field('password'), field('again')];
		if (password.length < 12) return this.signInMessage.set('Use 12 or more characters.');
		if (password !== again) return this.signInMessage.set('The two passwords differ.');
		await this.signIn(() => this.api.setPassword(pin, password), 'Password saved.', e.target as HTMLFormElement);
	}
	protected async removePassword(pin: string): Promise<void> {
		await this.signIn(() => this.api.removePassword(pin), 'Password removed; the PIN stays the way in.');
	}
	protected async choose(method: 'pin' | 'password', pin: string): Promise<void> {
		await this.signIn(
			() => this.api.setPreferred(pin, method),
			`The lock screen now opens with the ${method === 'pin' ? 'PIN' : 'password'}.`,
		);
	}
	private async signIn(work: () => Promise<unknown>, done: string, form?: HTMLFormElement): Promise<void> {
		try {
			await work();
			this.signInMessage.set(done);
			form?.reset();
			await this.lock.refetch();
		} catch (err) {
			this.signInMessage.set((err as Error).message);
		}
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

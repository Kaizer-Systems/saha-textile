import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { money } from './do-create';
import { EnvTagDialog, injectEnvTags } from './env-tag-dialog';
import { VendorState } from './vendor-screens';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { Loading } from '../shared/loading';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

import type { Droplet, DropletJob, DropletJobStep } from '@saha-textile/release-console-contracts';

const DISMISSED = 'rc-env-tag-dismissed';
function readDismissed(): string[] {
	try {
		const v: unknown = JSON.parse(sessionStorage.getItem(DISMISSED) ?? '[]');
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

/** DigitalOcean › Droplets › Creating, Ready and Destroy (brief v7), following one job live. */
@Component({
	selector: 'rc-do-jobs',
	imports: [VendorState, Loading, PinBoxes, EnvTagDialog],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (tab() === 'destroy') {
			<rc-vendor-state
				vendor="DigitalOcean"
				[answer]="droplets.data()"
				[pending]="droplets.isPending()"
				[failed]="droplets.isError()"
			>
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">
							Servers of {{ projectId() }} you can destroy · staging and development only
						</span>
					</div>
					<div class="rc-tw">
						<table class="rc-t">
							<thead>
								<tr>
									<th>Droplet</th>
									<th>Region</th>
									<th>Size</th>
									<th>IPv4</th>
									<th>Made</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								@for (d of removable(); track d.id) {
									<tr [class.sel]="d.id === picked()?.id">
										<td>
											<b>{{ d.name }}</b>
										</td>
										<td class="rc-mono">{{ d.region }}</td>
										<td class="rc-mono">{{ d.size }}</td>
										<td class="rc-mono">{{ d.ipv4 ?? '—' }}</td>
										<td class="rc-mono">{{ when(d.createdAt) }}</td>
										<td>
											<button
												type="button"
												class="rc-btn danger"
												(click)="pick(d)"
											>
												<span
													class="lock"
													aria-hidden="true"
												></span>
												Destroy
											</button>
										</td>
									</tr>
								} @empty {
									<tr>
										<td colspan="6">No staging or development droplet tagged {{ projectId() }}.</td>
									</tr>
								}
							</tbody>
						</table>
					</div>
					<p class="rc-note">
						Production is never destroyed from the console. Destroying removes the DNS records that point at
						the droplet, its Cloud Firewall, the droplet and its Cloudflare tunnel, in that order.
					</p>
				</div>
			</rc-vendor-state>
			@if (picked(); as d) {
				<div
					class="rc-modal-back"
					(keydown.escape)="picked.set(null)"
				>
					<form
						class="rc-modal"
						role="dialog"
						[attr.aria-label]="'Destroy ' + d.name"
						(submit)="$event.preventDefault(); destroy(d)"
					>
						<h3 class="rc-h">Destroy {{ d.name }}</h3>
						<p class="rc-p">
							The droplet, its disk and its address go away for good, and billing stops. Its DNS records,
							Cloud Firewall and Cloudflare tunnel are removed in the same job.
						</p>
						<div class="rc-form">
							<label>
								Type its name
								<span class="rc-msearch">
									<input
										type="text"
										autocomplete="off"
										[attr.aria-label]="'Type ' + d.name + ' to confirm'"
										(input)="typed.set($any($event.target).value)"
									/>
								</span>
							</label>
							<label>
								PIN
								<rc-pin-boxes
									label="Console PIN to destroy"
									[autofocus]="false"
									[disabled]="busy()"
									(changed)="pin.set($event)"
								/>
							</label>
						</div>
						@if (message(); as m) {
							<div class="rc-banner red small">
								<span class="rc-dot red"></span>
								<div>{{ m }}</div>
							</div>
						}
						<div class="rc-row end">
							<button
								type="button"
								class="rc-btn ghost"
								(click)="picked.set(null)"
							>
								Cancel
							</button>
							<button
								type="submit"
								class="rc-btn danger"
								[disabled]="typed().trim() !== d.name || pin().length !== pinLength || busy()"
							>
								<span
									class="lock"
									aria-hidden="true"
								></span>
								Destroy for good
							</button>
						</div>
					</form>
				</div>
			}
		} @else if (!jobId()) {
			@if (jobs.isPending()) {
				<rc-loading what="Reading the console's create and destroy jobs…" />
			} @else {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">Create and destroy jobs since the console started</span>
					</div>
					@for (j of jobs.data() ?? []; track j.id) {
						<div class="rc-act">
							<span>
								<b>{{ kindLabel(j) }} {{ j.name }}</b>
								<small>{{ when(j.startedAt) }} · {{ j.state }}</small>
							</span>
							<span></span>
							<button
								type="button"
								class="rc-btn ghost"
								(click)="open(j.id)"
							>
								Open
							</button>
						</div>
					} @empty {
						<p class="rc-note">No server is being created or destroyed. Start from 1 · Region.</p>
					}
				</div>
				<!-- Release Path brief F6, C6: each server's deploy token, with an alert 30 days before its end. -->
				@if (tokens.data()?.length) {
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">Deploy tokens · the tunnel's Access service token per server</span>
						</div>
						@for (t of tokens.data() ?? []; track t.name) {
							<div class="rc-act">
								<span>
									<b>{{ t.name }} deploy</b>
									<small [class.amber]="soon(t.expiresAt)">
										{{ t.expiresAt ? 'ends ' + when(t.expiresAt) : 'no end date' }}
										{{ soon(t.expiresAt) ? '· renew it now' : '' }}
									</small>
								</span>
								<span></span>
								<button
									type="button"
									class="rc-btn"
									[disabled]="pin().length !== pinLength || busy()"
									(click)="fix(t.environment, 'renew')"
								>
									Renew token
								</button>
							</div>
						}
						<div class="rc-form">
							<label>
								PIN
								<rc-pin-boxes
									label="Console PIN to renew a deploy token"
									[autofocus]="false"
									[disabled]="busy()"
									(changed)="pin.set($event)"
								/>
							</label>
						</div>
						<p class="rc-note">
							Renew token gives the token a new secret and updates the two GitHub secrets that hold it;
							nothing on the server changes.
						</p>
						@if (message()) {
							<p class="rc-note">{{ message() }}</p>
						}
					</div>
				}
			}
		} @else if (job.isPending()) {
			<rc-loading what="Reading the job…" />
		} @else if (job.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>{{ job.error().message }}</div>
			</div>
		} @else if (job.data(); as j) {
			@if (j.state === 'done' && j.kind === 'create') {
				<div class="rc-banner ok">
					<span class="rc-dot ok"></span>
					<div>
						<b>{{ j.name }} is ready</b>
						· {{ took(j) }} · {{ money(j.hourly) }} an hour from now.
					</div>
					@if (j.dropletId) {
						<button
							type="button"
							class="rc-btn ghost"
							(click)="tagging.set(true)"
						>
							<span
								class="lock"
								aria-hidden="true"
							></span>
							Tag environment
						</button>
					}
					<button
						type="button"
						class="rc-btn primary"
						(click)="firstDeploy(j)"
					>
						First deploy ›
					</button>
				</div>
				@if (j.dropletId && (tagging() || askTag(j))) {
					<!-- Owner, 23 Nov: when a create finishes, ask which environment the server is for. -->
					<rc-env-tag-dialog
						[resource]="'do:droplet:' + j.dropletId"
						[name]="j.name"
						[preset]="tagOf(j) ?? j.environment"
						(closed)="tagging.set(false); dismiss(j)"
					/>
				}
			} @else if (j.state === 'failed') {
				<div class="rc-banner red">
					<span class="rc-dot red"></span>
					<div>
						<b>{{ doing(j) }} {{ j.name }} stopped.</b>
						{{ j.error }}
					</div>
				</div>
			} @else if (j.state === 'done' && j.kind !== 'destroy') {
				<div class="rc-banner ok">
					<span class="rc-dot ok"></span>
					<div>
						<b>{{ j.name }} {{ j.kind === 'renew' ? 'has a new deploy token' : 'is set up' }}</b>
						· {{ took(j) }}.
					</div>
				</div>
			} @else if (j.state === 'done') {
				<div class="rc-banner ok">
					<span class="rc-dot ok"></span>
					<div>
						<b>{{ j.name }} is destroyed</b>
						· billing stopped.
					</div>
				</div>
			} @else {
				<div class="rc-row between">
					<div>
						<span class="rc-label">
							{{ j.kind === 'create' ? 'Creating' : 'Destroying' }} {{ j.name }}
							@if (j.kind === 'create') {
								· {{ money(j.monthly) }} a month
							}
						</span>
						<h3 class="rc-h">{{ percent(j) }}% · {{ current(j) }}</h3>
					</div>
				</div>
				<span class="rc-bar do-progress"><i [style.width.%]="percent(j)"></i></span>
			}
			<!-- Release Path brief 1.3: the ready card, what is left for you; Finish setup redoes only GitHub and the host key. -->
			@if (j.left.length) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">Left for you</span>
					</div>
					@for (x of j.left; track x.text) {
						<div class="rc-check">
							<span
								class="rc-dot"
								[class.amber]="x.blocking"
							></span>
							<b>{{ x.text }}</b>
							<span class="rc-mono">{{ x.blocking ? 'before a deploy' : 'once' }}</span>
						</div>
					}
					@if (j.state === 'failed' && j.kind !== 'destroy' && j.kind !== 'renew') {
						<div class="rc-row">
							<rc-pin-boxes
								label="Console PIN to finish setup"
								[autofocus]="false"
								[disabled]="busy()"
								(changed)="pin.set($event)"
							/>
							<button
								type="button"
								class="rc-btn primary"
								[disabled]="pin().length !== pinLength || busy()"
								(click)="fix(j.environment, 'finish')"
							>
								Finish setup
							</button>
						</div>
						<p class="rc-note">
							Finish setup gives the deploy token a new secret, then redoes only the GitHub environment,
							the identity and approval check and the host key.
						</p>
						@if (message()) {
							<p class="rc-note">{{ message() }}</p>
						}
					}
				</div>
			}
			<div class="rc-g2">
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">Each step, as it happens</span></div>
					<div class="rc-checks">
						@for (s of j.steps; track s.key) {
							<div class="rc-check">
								@if (s.state === 'running') {
									<span class="rc-dot cy pulse"></span>
								} @else {
									<span
										class="rc-chk"
										[class]="'rc-chk ' + chk(s)"
										aria-hidden="true"
									></span>
								}
								<b [class.muted]="s.state === 'queued'">
									{{ s.label }}
									@if (s.detail) {
										<br />
										<span class="rc-mono">{{ s.detail }}</span>
									}
								</b>
								<span class="rc-mono">{{ s.ms === null ? '' : secs(s.ms) }}</span>
							</div>
						}
					</div>
				</div>
				<div class="rc-panel">
					<div class="rc-ph"><span class="rc-label">The server</span></div>
					<div class="rc-kv">
						<div>
							<span>Name</span>
							<em>{{ j.name }}</em>
						</div>
						<div>
							<span>Environment</span>
							<em>{{ j.environment }}</em>
						</div>
						<div>
							<span>Droplet</span>
							<em class="rc-mono">{{ j.dropletId ?? '—' }}</em>
						</div>
						@if (j.kind === 'create' && j.dropletId) {
							<div>
								<span>Environment tag</span>
								<em>{{ tagOf(j) ?? 'not tagged yet' }}</em>
							</div>
						}
						<div>
							<span>Addresses</span>
							<em class="rc-mono">
								{{ addresses(j) }}
							</em>
						</div>
						@if (j.kind === 'create' && j.privateIp) {
							<div>
								<span>SSH, WARP on (iTerm, Termius)</span>
								<em class="rc-mono">ssh {{ admin }}@{{ j.privateIp }}</em>
							</div>
							<div>
								<span>SFTP, WARP on (Mountain Duck)</span>
								<em class="rc-mono">sftp://{{ admin }}@{{ j.privateIp }}:22</em>
							</div>
						}
						@if (j.kind === 'create' && j.sshHost) {
							<div>
								<span>Browser terminal (any phone)</span>
								<em class="rc-mono">https://{{ j.sshHost }}</em>
							</div>
							<div>
								<span>Laptop without WARP</span>
								<em class="rc-mono">
									ssh -o ProxyCommand="cloudflared access ssh --hostname %h" {{ admin }}@{{
										j.sshHost
									}}
								</em>
							</div>
						}
						@if (j.kind === 'create') {
							<div>
								<span>Cost</span>
								<em class="amber">{{ money(j.monthly) }} a month · {{ money(j.hourly) }} an hour</em>
							</div>
						}
						<div>
							<span>Started</span>
							<em class="rc-mono">{{ when(j.startedAt) }}</em>
						</div>
						<div>
							<span>Audit</span>
							<em class="ok">with your PIN, in the console's audit log</em>
						</div>
					</div>
					<p class="rc-note">
						SSH reaches the server only through its Cloudflare tunnel, once the first boot has run. Until
						the tunnel is up, the console knows only what DigitalOcean reports.
					</p>
				</div>
			</div>
		}
	`,
})
export class DoJobsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	readonly tab = input('creating');

	protected readonly when = when;
	protected readonly money = money;
	protected readonly pinLength = PIN_LENGTH;
	/** The admin user the first-boot file makes (scripts/release-console/first-boot.mjs). */
	protected readonly admin = 'saha-textile-admin';
	protected readonly jobId = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((q) => q.get('job') ?? '')), {
		initialValue: '',
	});
	protected readonly projectId = computed(() => this.ctx.projectId() ?? '');
	private readonly slot = computed(() => this.ctx.repo()?.cloud.find((c) => c.vendor === 'digitalocean')?.id ?? '');
	private args(): [string, string, string] {
		return [this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.slot()];
	}

	protected readonly job = injectQuery(() => ({
		queryKey: ['droplet-job', this.jobId()],
		queryFn: () => this.api.dropletJob(...this.args(), this.jobId()),
		enabled: !!this.jobId() && !!this.slot(),
		refetchInterval: (q: { state: { data?: DropletJob } }) =>
			q.state.data && q.state.data.state !== 'running' ? false : 2_000,
	}));
	protected readonly jobs = injectQuery(() => ({
		queryKey: ['droplet-jobs', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.dropletJobs(...this.args()),
		enabled: !this.jobId() && this.tab() !== 'destroy' && !!this.slot(),
	}));
	protected readonly droplets = injectQuery(() => ({
		queryKey: ['vendor', 'droplets', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.droplets(...this.args()),
		enabled: this.tab() === 'destroy' && !!this.slot(),
	}));
	protected readonly removable = computed(() => {
		const a = this.droplets.data();
		const p = this.projectId();
		return (a?.state === 'ok' ? a.data : []).filter(
			(d) => d.tags.includes(p) && !/prod/i.test(d.name) && !d.tags.some((t) => /prod/i.test(t)),
		);
	});

	protected readonly tags = injectEnvTags();
	/** The tag box opened by hand (Tag environment), or shown once a create is done and untagged. */
	protected readonly tagging = signal(false);
	private readonly dismissed = signal<ReadonlySet<string>>(new Set(readDismissed()));
	protected tagOf(j: DropletJob): string | null {
		return j.dropletId ? (this.tags.data()?.[`do:droplet:${j.dropletId}`] ?? null) : null;
	}
	/** Ask once per finished create, after the tags are read, unless already tagged or cancelled. */
	protected askTag(j: DropletJob): boolean {
		return (
			j.kind === 'create' &&
			j.state === 'done' &&
			this.tags.isSuccess() &&
			!this.tagOf(j) &&
			!this.dismissed().has(j.id)
		);
	}
	protected dismiss(j: DropletJob): void {
		const next = new Set(this.dismissed()).add(j.id);
		this.dismissed.set(next);
		try {
			sessionStorage.setItem(DISMISSED, JSON.stringify([...next]));
		} catch {
			// A private window may refuse storage; the box then asks again on the next visit.
		}
	}

	protected readonly picked = signal<Droplet | null>(null);
	protected readonly typed = signal('');
	protected readonly pin = signal('');
	protected readonly busy = signal(false);
	protected readonly message = signal('');

	protected pick(d: Droplet): void {
		this.typed.set('');
		this.message.set('');
		this.picked.set(d);
	}
	protected async destroy(d: Droplet): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			const job = await this.api.destroyDroplet(...this.args(), {
				pin: this.pin(),
				confirm: this.typed().trim(),
				dropletId: d.id,
			});
			this.picked.set(null);
			this.open(job.id);
		} catch (err) {
			this.message.set(err instanceof Error ? err.message : 'The console API did not answer.');
		} finally {
			this.busy.set(false);
		}
	}
	/** Each server's deploy token and its end date (Release Path brief C6). */
	protected readonly tokens = injectQuery(() => ({
		queryKey: ['deploy-tokens', this.ctx.projectId(), this.ctx.repoId()],
		queryFn: () => this.api.deployTokens(...this.args()),
		enabled: !this.jobId() && !!this.slot(),
		staleTime: 60_000,
	}));
	protected soon(at: string | null): boolean {
		return !!at && Date.parse(at) - Date.now() < 30 * 86_400_000;
	}
	protected kindLabel(j: DropletJob): string {
		return { create: 'Create', destroy: 'Destroy', finish: 'Finish setup', renew: 'Renew token' }[j.kind];
	}
	protected doing(j: DropletJob): string {
		return {
			create: 'Creating',
			destroy: 'Destroying',
			finish: 'Finishing setup of',
			renew: 'Renewing the token of',
		}[j.kind];
	}
	/** Finish setup or Renew token, after the PIN; the new job opens. */
	protected async fix(environment: string, kind: 'finish' | 'renew'): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			const job = await this.api.serverFix(...this.args(), { pin: this.pin(), environment, kind });
			this.open(job.id);
		} catch (err) {
			this.message.set(err instanceof Error ? err.message : 'The console API did not answer.');
		} finally {
			this.busy.set(false);
		}
	}
	protected open(id: string): void {
		void this.router.navigate([], { queryParams: { tab: 'creating', job: id }, queryParamsHandling: 'merge' });
	}
	protected firstDeploy(j: DropletJob): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'r', this.ctx.repoId(), 'deploy'], {
			queryParams: { tab: j.environment },
		});
	}

	protected chk(s: DropletJobStep): string {
		return { done: 'ok', failed: 'fail', skipped: 'skip', queued: 'queued', running: 'run' }[s.state];
	}
	protected addresses(j: DropletJob): string {
		return [j.ipv4, j.ipv6, j.privateIp ? `private ${j.privateIp}` : null].filter(Boolean).join(' · ') || '—';
	}
	protected percent(j: DropletJob): number {
		const finished = j.steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
		return Math.round((finished / Math.max(1, j.steps.length)) * 100);
	}
	protected current(j: DropletJob): string {
		return j.steps.find((s) => s.state === 'running')?.label ?? 'starting';
	}
	protected secs(ms: number): string {
		return ms < 1000
			? `${ms} ms`
			: ms < 60_000
				? `${Math.round(ms / 1000)} s`
				: `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
	}
	protected took(j: DropletJob): string {
		const ms = (j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.startedAt);
		return this.secs(ms);
	}
}

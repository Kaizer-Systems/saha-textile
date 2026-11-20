import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';

import { serverLane } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { BrandLogo, Icon } from '../shared/icons';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

import type { DeployRun, ServerDeployView } from '@saha-textile/release-console-contracts';

/** Each lane row's icon. */
const LANE_ICONS: Record<string, string> = {
	checks: 'tabler/list-check',
	proof: 'tabler/test-pipe',
	images: 'tabler/brand-docker',
	approval: 'tabler/user-check',
	release: 'tabler/key',
	login: 'tabler/plug-connected',
	deploy: 'tabler/rocket',
	health: 'tabler/heartbeat',
};

/** What a GitHub environment still needs before deploy.yml can deploy to it, in words. */
export function setupGaps(v: ServerDeployView): string[] {
	const gaps: string[] = [];
	if (!v.setup.workflowOnBranch)
		gaps.push(`deploy.yml is not on the ${v.branch} branch and the default branch yet: merge it there first.`);
	if (!v.setup.environmentExists) gaps.push(`GitHub has no environment named ${v.target}.`);
	if (v.setup.missingVariables?.length) gaps.push(`Variables to add: ${v.setup.missingVariables.join(', ')}.`);
	if (v.setup.missingSecrets?.length) gaps.push(`Secrets to add: ${v.setup.missingSecrets.join(', ')}.`);
	if (v.setup.missingVariables === null || v.setup.missingSecrets === null)
		gaps.push("The GitHub key cannot list this environment's variables or secrets, so they were not checked.");
	return gaps;
}

/** The run's state in one word, as the brief's reactor shows it. */
export function runTitle(run: DeployRun | null): string {
	if (!run) return 'No deploy yet';
	if (run.waiting.length) return 'Waiting for you';
	if (run.status !== 'completed') return run.status === 'queued' ? 'Queued' : 'Deploying';
	return run.conclusion === 'success' ? 'Live' : run.conclusion === 'cancelled' ? 'Cancelled' : 'Failed';
}

/**
 * Ship › Live deploy for an environment that runs on a server (owner, 20 Nov): GitHub's deploy.yml
 * builds and checks the commit, publishes its images to GHCR, waits for the owner's approval,
 * writes the release from Infisical, signs in to the server through the Cloudflare tunnel, pulls
 * the images by digest, runs the release steps, switches the apps and checks health. The console
 * starts it with the PIN, follows each job and step, and approves or rejects the wait with the PIN.
 * Laid out as the Safe Releases Brief's Live deploy: lane, release dial, systems and events.
 */
@Component({
	selector: 'rc-server-deploy-screen',
	imports: [Icon, BrandLogo, PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (view.data(); as a) {
			@if (a.state === 'ok') {
				@let d = a.data;
				@let gaps = gapsOf(d);
				@if (gaps.length) {
					<div class="rc-banner amber small">
						<span class="rc-dot amber"></span>
						<div>
							<b>Before the first deploy to {{ d.target }}, set up its GitHub environment.</b>
							@for (g of gaps; track g) {
								<div>{{ g }}</div>
							}
							The server itself comes from
							<code>pnpm server:create</code>
							and the steps in docker/production/README.md, "A new server".
						</div>
					</div>
				}
				<div class="rc-g3 deploy">
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/route-2" />
								Pipeline
							</span>
						</div>
						<ul class="rc-lane">
							@for (s of lane(); track s.key) {
								<li [class]="s.cls">
									<span
										class="rc-dot"
										[class.ok]="s.cls === 'ok'"
										[class.red]="s.cls === 'red'"
										[class.cy]="s.cls === 'run'"
										[class.pulse]="s.cls === 'run'"
									></span>
									<span>
										<rc-icon [name]="laneIcons[s.key] ?? 'tabler/circle-dashed'" />
										{{ s.label }}
									</span>
									<span class="rc-mono">{{ s.time }}</span>
								</li>
							}
						</ul>
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/rocket" />
								Release
							</span>
						</div>
						<div class="rc-reactor">
							<svg
								viewBox="0 0 240 240"
								aria-hidden="true"
							>
								<g [class.rc-spin]="running()">
									<circle
										cx="120"
										cy="120"
										r="112"
										fill="none"
										stroke="rgba(94,214,255,0.35)"
										stroke-width="1"
										stroke-dasharray="2 6"
									/>
								</g>
								<g [class.rc-spin-r]="running()">
									<circle
										cx="120"
										cy="120"
										r="102"
										fill="none"
										stroke="rgba(94,214,255,0.25)"
										stroke-width="6"
										stroke-dasharray="40 14 8 14"
									/>
								</g>
								<circle
									cx="120"
									cy="120"
									r="86"
									fill="none"
									stroke="rgba(94,214,255,0.12)"
									stroke-width="10"
								/>
								<circle
									cx="120"
									cy="120"
									r="86"
									fill="none"
									[attr.stroke]="colour()"
									stroke-width="10"
									pathLength="100"
									[attr.stroke-dasharray]="progress() + ' 100'"
									transform="rotate(-90 120 120)"
								/>
								<text
									x="120"
									y="122"
									text-anchor="middle"
									fill="#d9f4ff"
									font-family="Chakra Petch, sans-serif"
									font-size="38"
									font-weight="600"
								>
									{{ progress() }}%
								</text>
								<text
									x="120"
									y="146"
									text-anchor="middle"
									fill="#7fa3b8"
									font-family="IBM Plex Mono, monospace"
									font-size="10.5"
								>
									{{ d.run ? d.run.branch + ' · ' + d.run.commit : 'no run yet' }}
								</text>
							</svg>
						</div>
						<div class="rc-center">
							<b
								class="rc-big"
								[class.ok]="title() === 'Live'"
								[class.red]="title() === 'Failed' || title() === 'Cancelled'"
								[class.amber]="title() === 'Waiting for you'"
							>
								{{ title() }}
							</b>
						</div>
					</div>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/server" />
								Systems
							</span>
						</div>
						<div class="rc-kv">
							<div>
								<span>
									<rc-brand-logo
										name="logos/github-icon"
										[size]="14"
										label="GitHub environment"
									/>
								</span>
								<em>{{ d.target }}</em>
							</div>
							<div>
								<span>Branch</span>
								<em>{{ d.branch }}</em>
							</div>
							<div>
								<span>Commit</span>
								<em>{{ d.run?.commit ?? '—' }}</em>
							</div>
							<div>
								<span>Started</span>
								<em>{{ d.run ? when(d.run.createdAt) : '—' }}</em>
							</div>
						</div>
						<div class="rc-label">
							<rc-icon name="tabler/list" />
							Events
						</div>
						<div class="rc-log">
							@for (e of events(); track $index) {
								<div [class]="'l ' + e.level">
									<span class="n">{{ e.time }}</span>
									<span class="src">{{ e.job }}</span>
									<span class="m">{{ e.text }}</span>
								</div>
							} @empty {
								<div class="l dim">
									<span class="n">—</span>
									<span class="m">Steps of the run appear here.</span>
								</div>
							}
						</div>
					</div>
				</div>

				<div class="rc-g2">
					<form
						class="rc-panel"
						(submit)="start($event)"
					>
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/cloud" />
								Deploy to {{ d.target }} · from {{ d.branch }}
							</span>
						</div>
						<p class="rc-note">
							GitHub runs the checks, publishes the images to GHCR when this commit has none, then waits
							for your approval before anything reaches the server.
						</p>
						<div class="rc-form">
							<label>
								PIN
								<rc-pin-boxes
									label="Console PIN to deploy"
									[autofocus]="false"
									[disabled]="busy()"
									(changed)="pin.set($event)"
								/>
							</label>
						</div>
						<div class="rc-row">
							@if (d.run?.waiting?.length) {
								<button
									type="button"
									class="rc-btn primary"
									[disabled]="!pinReady() || busy()"
									(click)="review(true)"
								>
									Approve the deploy
								</button>
								<button
									type="button"
									class="rc-btn danger"
									[disabled]="!pinReady() || busy()"
									(click)="review(false)"
								>
									Reject
								</button>
							} @else {
								<button
									type="submit"
									class="rc-btn primary"
									[disabled]="!pinReady() || busy() || running()"
								>
									Start the deploy
								</button>
							}
							@if (d.run) {
								<a
									class="rc-btn ghost"
									[href]="d.run.url"
									target="_blank"
									rel="noopener"
								>
									<rc-icon name="tabler/external-link" />
									Open in GitHub
								</a>
							}
						</div>
						@if (message()) {
							<p class="rc-note">{{ message() }}</p>
						}
					</form>
					<div class="rc-panel">
						<div class="rc-ph">
							<span class="rc-label">
								<rc-icon name="tabler/history" />
								Recent deploys
							</span>
						</div>
						<div class="rc-tw">
							<table class="rc-t">
								<thead>
									<tr>
										<th>Commit</th>
										<th>Started</th>
										<th>State</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									@for (r of runs(d); track r.id) {
										<tr>
											<td class="rc-mono">{{ r.commit }}</td>
											<td class="rc-mono">{{ when(r.createdAt) }}</td>
											<td>
												<span
													class="rc-pill"
													[class.ok]="r.conclusion === 'success'"
													[class.red]="r.conclusion === 'failure'"
													[class.cy]="r.status !== 'completed'"
													[class.muted]="
														r.conclusion === 'cancelled' || r.conclusion === 'skipped'
													"
												>
													{{ r.status === 'completed' ? r.conclusion : r.status }}
												</span>
											</td>
											<td>
												<a
													class="rc-btn ghost"
													[href]="r.url"
													target="_blank"
													rel="noopener"
												>
													Open
												</a>
											</td>
										</tr>
									} @empty {
										<tr>
											<td colspan="4">No deploy to {{ d.target }} yet.</td>
										</tr>
									}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			} @else {
				<div
					class="rc-banner small"
					[class.amber]="a.state === 'not-connected'"
					[class.red]="a.state === 'error'"
				>
					<span
						class="rc-dot"
						[class.amber]="a.state === 'not-connected'"
						[class.red]="a.state === 'error'"
					></span>
					<div>
						<b>
							{{ a.state === 'error' ? 'GitHub answered with an error.' : 'No server deploy here yet.' }}
						</b>
						{{ a.message }}
					</div>
				</div>
			}
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div><b>The console API is not answering.</b></div>
			</div>
		} @else {
			<p class="rc-p muted">Reading the deploy runs from GitHub…</p>
		}
	`,
})
export class ServerDeployScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly pins = viewChild(PinBoxes);
	readonly environment = input.required<string>();
	protected readonly when = when;
	protected readonly laneIcons = LANE_ICONS;
	protected readonly gapsOf = setupGaps;
	protected readonly pin = signal('');
	protected readonly busy = signal(false);
	protected readonly message = signal('');

	protected readonly view = injectQuery(() => ({
		queryKey: ['server-deploy', this.ctx.projectId(), this.ctx.repoId(), this.environment()],
		queryFn: () => this.api.serverDeploy(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.environment()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		// Follow a live run closely; a quiet environment is read again every half minute.
		refetchInterval: (q: { state: { data?: unknown } }) => {
			const a = q.state.data as { state?: string; data?: ServerDeployView } | undefined;
			const run = a?.state === 'ok' ? a.data?.run : null;
			return run && run.status !== 'completed' ? 5000 : 30_000;
		},
	}));
	private readonly run = computed(() => {
		const a = this.view.data();
		return a?.state === 'ok' ? a.data.run : null;
	});
	protected readonly lane = computed(() => serverLane(this.run()));
	protected readonly running = computed(() => {
		const r = this.run();
		return !!r && r.status !== 'completed';
	});
	protected readonly title = computed(() => runTitle(this.run()));
	protected readonly progress = computed(() => {
		const rows = this.lane().filter((r) => r.cls !== 'skip');
		return rows.length ? Math.round((100 * rows.filter((r) => r.cls === 'ok').length) / rows.length) : 0;
	});
	protected readonly colour = computed(() =>
		this.title() === 'Failed' || this.title() === 'Cancelled'
			? '#ff5d5d'
			: this.title() === 'Live'
				? '#5dffa8'
				: '#5ed6ff',
	);
	/** Finished and running steps of the run, newest first. */
	protected readonly events = computed(() => {
		const run = this.run();
		if (!run) return [];
		const out: { at: string; time: string; job: string; text: string; level: string }[] = [];
		for (const j of run.jobs) {
			const jobAt = j.completedAt ?? j.startedAt;
			if (jobAt && j.conclusion !== 'skipped')
				out.push({
					at: jobAt,
					time: new Date(jobAt).toLocaleTimeString('en-IN', { hour12: false }),
					job: 'job',
					text: j.status === 'completed' ? `${j.name}: ${j.conclusion}` : `${j.name}…`,
					level: j.conclusion === 'failure' ? 'err' : j.status !== 'completed' ? 'note' : 'dim',
				});
			for (const s of j.steps) {
				const at = s.completedAt ?? s.startedAt;
				if (!at || s.conclusion === 'skipped') continue;
				out.push({
					at,
					time: new Date(at).toLocaleTimeString('en-IN', { hour12: false }),
					job: j.name
						.replace(/^Deploy to .*/, 'deploy')
						.replace(/^Publish \/ /, '')
						.slice(0, 18),
					text: s.status === 'completed' ? `${s.name}: ${s.conclusion}` : `${s.name}…`,
					level: s.conclusion === 'failure' ? 'err' : s.status !== 'completed' ? 'note' : '',
				});
			}
		}
		return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
	});
	protected readonly pinReady = computed(() => this.pin().length === PIN_LENGTH);

	protected runs(d: ServerDeployView) {
		return [...(d.run ? [d.run] : []), ...d.recent];
	}

	protected async start(e: Event): Promise<void> {
		e.preventDefault();
		await this.act(
			() =>
				this.api.startServerDeploy(
					this.ctx.projectId() ?? '',
					this.ctx.repoId() ?? '',
					this.environment(),
					this.pin(),
				),
			'Started. GitHub shows the run in a few seconds; the deploy job then waits for your approval here.',
		);
	}

	protected async review(approve: boolean): Promise<void> {
		const run = this.run();
		if (!run) return;
		await this.act(
			() =>
				this.api.reviewServerDeploy(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.environment(), {
					pin: this.pin(),
					runId: run.id,
					approve,
				}),
			approve ? 'Approved: the deploy job starts now.' : 'Rejected: nothing reaches the server.',
		);
	}

	private async act(call: () => Promise<unknown>, done: string): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			await call();
			this.message.set(done);
			setTimeout(() => void this.view.refetch(), 3000);
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
			this.pins()?.clear();
		}
	}
}

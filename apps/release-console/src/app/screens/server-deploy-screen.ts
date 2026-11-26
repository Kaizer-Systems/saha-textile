import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import {
	BLANK_TOGETHER,
	BRANCH_PICKED_TARGETS,
	DATA_FILE_IDS,
	DATA_SECRET_LABELS,
	type RotateId,
	neverBlankReason,
	rotateRowsOf,
	serverLane,
	DeployRun,
	ServerDeployView,
	ServerTarget,
} from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { BranchPicker } from '../shared/branch-picker';
import { BrandLogo, Icon } from '../shared/icons';
import { Loading } from '../shared/loading';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

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
 * The blank values a server deploy would stop on (required for a release, not set, in /api), split
 * into those it may go ahead without (tagged `may-deploy-blank`; a set that goes together only when
 * every one of it is blank) and the rest, each with the reason it has to be filled.
 */
export function requiredBlanks(
	folders: {
		folder: string;
		rows: { name: string; state: string; requiredForRelease?: boolean; mayDeployBlank?: boolean }[];
	}[],
): { offered: string[]; never: { name: string; reason: string }[] } {
	const blank = (folders.find((f) => f.folder === 'api')?.rows ?? []).filter(
		(r) => r.requiredForRelease && r.state !== 'set',
	);
	const offered = new Set(
		blank.filter((r) => r.mayDeployBlank && neverBlankReason(r.name) === null).map((r) => r.name),
	);
	const reasons = new Map<string, string>();
	for (const group of BLANK_TOGETHER) {
		const picked = group.filter((n) => offered.has(n));
		if (!picked.length || picked.length === group.length) continue;
		const filled = group.filter((n) => !picked.includes(n));
		for (const n of picked) {
			offered.delete(n);
			reasons.set(n, `goes with ${filled.join(', ')}, which is set: fill it too, or empty all ${group.length}`);
		}
	}
	return {
		offered: [...offered].sort(),
		never: blank
			.filter((r) => !offered.has(r.name))
			.map((r) => ({
				name: r.name,
				reason: reasons.get(r.name) ?? neverBlankReason(r.name) ?? 'every release needs it',
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

/** The names picked or put back together with `name` (a set that goes together moves as one). */
export function togetherWith(name: string, offered: string[]): string[] {
	const group = BLANK_TOGETHER.find((g) => g.includes(name));
	return group ? group.filter((n) => offered.includes(n)) : [name];
}

/** What stops working while these values stay blank, and whether everything else still works. */
export function blankEffects(names: string[]): { stops: string[]; restWorks: boolean } {
	const groups: [RegExp, string][] = [
		[/^MSG91_/, 'sign-in codes and texts are not sent (MSG91)'],
		[/^SPACES_/, 'photo uploads are off (Spaces)'],
	];
	const stops = new Set<string>();
	let unknown = false;
	for (const n of names) {
		const g = groups.find(([re]) => re.test(n));
		if (g) stops.add(g[1]);
		else {
			stops.add(`whatever reads ${n}`);
			unknown = true;
		}
	}
	return { stops: [...stops], restWorks: !unknown };
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
	imports: [Loading, Icon, BrandLogo, PinBoxes, BranchPicker],
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
				<!-- Why the newest run is not live (Release Path brief 4.1, paths F8/R2 and F12). -->
				@if (d.run?.conclusion === 'failure' && d.failure; as f) {
					@if (f.kind === 'refused-secrets') {
						<div class="rc-banner amber small">
							<span class="rc-dot amber"></span>
							<div>
								<b>
									{{ refusedLabel(f.names) }} in Infisical
									{{ f.names.length === 1 ? 'differs' : 'differ' }} from what the server runs with.
								</b>
								The server changed nothing. Rotate {{ f.names.length === 1 ? 'it' : 'them' }} in this
								deploy, or put the old value back.
							</div>
							<button
								type="button"
								class="rc-btn primary"
								(click)="rotateAgain(f.names)"
							>
								Deploy again with rotation
							</button>
							<button
								type="button"
								class="rc-btn ghost"
								(click)="go('secrets', 'rotate')"
							>
								Run › Secrets
							</button>
						</div>
					} @else {
						<div class="rc-banner red small">
							<span class="rc-dot red"></span>
							<div>
								<b>{{ f.step ? f.step + ' failed:' : 'The deploy stopped on the server:' }}</b>
								{{ f.message }}.
								{{
									f.kind === 'release-step'
										? 'The deploy stopped before the switch; ' +
											d.target +
											' still runs the previous release.'
										: 'The previous release keeps serving.'
								}}
							</div>
							<button
								type="button"
								class="rc-btn ghost"
								(click)="go('steps', 'blocked')"
							>
								Release steps
							</button>
							<a
								class="rc-btn ghost"
								[href]="d.run.url"
								target="_blank"
								rel="noopener"
							>
								Logs
							</a>
						</div>
					}
				}
				<!-- After a deploy: through Cloudflare, and the release tag it recorded (Release Path brief 2.7, F15). -->
				@if (d.run?.status === 'completed' && reach.data(); as rc) {
					@if (allReachable(rc.checks)) {
						<div class="rc-g2">
							<div class="rc-banner ok small">
								<span class="rc-dot ok"></span>
								<div>
									<b>Through Cloudflare:</b>
									reachable · {{ rc.checks.length }} checks passed.
								</div>
							</div>
							@if (recordedTag(d); as t) {
								<div class="rc-banner small">
									<span class="rc-dot"></span>
									<div>
										<b>Recorded:</b>
										<span class="rc-mono">tag {{ t }}</span>
										· the version Rollback can return to.
									</div>
								</div>
							}
						</div>
					} @else {
						<div class="rc-panel">
							<div class="rc-ph">
								<span class="rc-label">
									<rc-icon name="tabler/cloud" />
									Through Cloudflare · not reachable
								</span>
								<button
									type="button"
									class="rc-btn ghost"
									[disabled]="reach.isFetching()"
									(click)="reach.refetch()"
								>
									Check again
								</button>
							</div>
							<div class="rc-tw">
								<table class="rc-t">
									<thead>
										<tr>
											<th>Check</th>
											<th>Result</th>
										</tr>
									</thead>
									<tbody>
										@for (c of rc.checks; track c.key) {
											<tr>
												<td>{{ c.label }}</td>
												<td
													[class.ok]="c.ok === true"
													[class.red]="c.ok === false"
													[class.amber]="c.ok === null"
												>
													{{ c.detail }}
												</td>
											</tr>
										}
									</tbody>
								</table>
							</div>
							@if (d.target === 'production') {
								<div class="rc-form">
									<label>
										Type production to roll back
										<div class="rc-msearch">
											<input
												type="text"
												autocomplete="off"
												aria-label="Type production to roll back"
												[value]="cardConfirm()"
												(input)="cardConfirm.set($any($event.target).value)"
											/>
										</div>
									</label>
								</div>
							}
							<div class="rc-row">
								<rc-pin-boxes
									label="Console PIN to fix or roll back"
									[autofocus]="false"
									[disabled]="busy()"
									(changed)="cardPin.set($event)"
								/>
								@if (hasFix(rc.checks)) {
									<button
										type="button"
										class="rc-btn primary"
										[disabled]="cardPin().length !== pinLength || busy()"
										(click)="fixOriginPulls()"
									>
										Turn origin pulls on again
									</button>
								}
								<button
									type="button"
									class="rc-btn danger"
									[disabled]="
										cardPin().length !== pinLength ||
										busy() ||
										running() ||
										(d.target === 'production' && cardConfirm().trim() !== 'production')
									"
									(click)="rollback()"
								>
									Roll back
								</button>
								<span class="rc-note">Both ask for the PIN.</span>
							</div>
						</div>
					}
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
								Deploy to {{ d.target }} · from {{ pickedBranch() || d.branch }}
							</span>
						</div>
						<!-- A server environment's branch is fixed here; it changes only in the wizard or Project settings › Repositories (owner, 20 Nov). -->
						@if (picksBranch(d.target)) {
							<!-- A development server may try any branch for one run (owner, 21 Nov; brief screen 12). -->
							<rc-branch-picker
								label="Branch"
								context="this deploy"
								[branches]="branches.data()?.branches ?? []"
								[defaultBranch]="branches.data()?.defaultBranch ?? null"
								[current]="branches.data()?.current ?? null"
								[value]="pickedBranch() || d.branch || ''"
								[waitingText]="branches.data()?.note || 'loading branches…'"
								[refreshing]="branches.isFetching()"
								(picked)="pickedBranch.set($event)"
								(refresh)="refreshBranches()"
							/>
							<p class="rc-note">
								Editable here: a development server can try any branch. Its saved branch stays
								{{ d.branch }}.
							</p>
						} @else {
							<div class="rc-states">
								<rc-icon name="tabler/git-branch" />
								<span class="rc-mono">{{ d.branch }}</span>
								<span class="rc-pill muted wraps">
									locked · change it in Project settings › Repositories
								</span>
							</div>
						}
						<p class="rc-note">
							GitHub runs the checks, publishes the images to GHCR when this commit has none, then waits
							for your approval before anything reaches the server.
						</p>
						<!-- Deploy with chosen blanks (owner, 21 Nov; brief 26gq3NbcbBESea6abRtsa3, screen 12, drawn as approved). -->
						@if (blankCount()) {
							<div class="rc-banner amber small">
								<span class="rc-dot amber"></span>
								<div>
									<b>{{ blankCount() }} required values are blank in {{ placeName() }}</b>
									(read when this tab opened, names only). The deploy stops on blanks unless you allow
									them below.
								</div>
								@if (blankSplit().offered.length) {
									<button
										type="button"
										class="rc-btn primary"
										(click)="allowAll()"
									>
										Allow all {{ blankSplit().offered.length }}
									</button>
								}
								<button
									type="button"
									class="rc-btn ghost"
									[disabled]="blanks.isFetching()"
									(click)="blanks.refetch()"
								>
									Check again
								</button>
							</div>
							<span class="rc-label">Deploy even though these are blank</span>
							<div class="rc-msearch multi">
								@for (n of allowed(); track n) {
									<button
										type="button"
										class="rc-chip on"
										[title]="'Put ' + n + ' back in the list'"
										(click)="unallow(n)"
									>
										{{ n }} ✕
									</button>
								}
								<input
									type="search"
									autocomplete="off"
									aria-label="Search blank values to allow"
									placeholder="search blank names…"
									[value]="blankQuery()"
									(focus)="blankOpen.set(true)"
									(blur)="blankOpen.set(false)"
									(input)="blankQuery.set($any($event.target).value)"
								/>
								@if (blankOpen()) {
									<div
										class="rc-mres"
										role="listbox"
									>
										@for (n of offered(); track n) {
											<button
												type="button"
												class="rc-mrow"
												role="option"
												(mousedown)="$event.preventDefault(); allow(n)"
											>
												<span class="t rc-mono">{{ n }}</span>
												<span class="p">/api · blank</span>
											</button>
										}
										@for (x of neverShown(); track x.name) {
											<div
												class="rc-mrow off"
												aria-disabled="true"
											>
												<span class="t rc-mono">{{ x.name }}</span>
												<span class="p">cannot be blank: {{ x.reason }}</span>
											</div>
										}
										@if (!offered().length && !neverShown().length) {
											<div class="rc-mnone">Nothing left to allow.</div>
										}
									</div>
								}
							</div>
							<p class="rc-note">
								Opening the tab reads the environment at once and lists every blank value that would
								stop the deploy; Allow all adds the ones it may go ahead without as chips in one click.
								✕ puts a name back in the list. Only values the release allows blank are offered (today
								the MSG91 key and the three Spaces keys, which go together); every other required value
								is greyed with the reason it has to be filled. Payment keys never stop a deploy:
								payments simply answer "not configured" until they are set.
							</p>
							@if (allowed().length) {
								<span class="rc-label">What runs</span>
								<p class="rc-note rc-mono">deploy.yml · allow_blank = {{ allowed().join(',') }}</p>
								<p class="rc-note rc-mono">
									→ release {{ d.target }}
									@for (n of allowed(); track n) {
										{{ ' ' }}
										<span class="rc-flag">--allow-blank {{ n }}</span>
									}
								</p>
								<p class="rc-note">
									What stops working until they are filled: {{ effects().stops.join('; ') }}.
									@if (effects().restWorks) {
										The shop, admin, catalogue and browsing work.
									}
								</p>
							}
						}
						<!-- Rotate secrets in this deploy (Release Path brief 2.3 and 3.2). -->
						<span class="rc-label">Rotate secrets in this deploy</span>
						@if (rotateIds().length) {
							<div class="rc-banner amber small">
								<span class="rc-dot amber"></span>
								<div>
									<b>
										{{ rotateRows().length }}
										{{ rotateRows().length === 1 ? 'value' : 'values' }} in Infisical
										{{ rotateRows().length === 1 ? 'differs' : 'differ' }} from what the server
										runs.
									</b>
									This deploy changes them on the server before the switch.
								</div>
							</div>
							@for (row of rotateRows(); track row.key) {
								<div
									class="do-tick on"
									role="checkbox"
									aria-checked="true"
									aria-disabled="true"
								>
									<i aria-hidden="true"></i>
									<span>{{ row.label }} · {{ row.scheduled }}</span>
								</div>
							}
							@if (rotateIds().includes('keyfile')) {
								<div
									class="do-tick"
									role="checkbox"
									tabindex="0"
									[attr.aria-checked]="restartDb()"
									[class.on]="restartDb()"
									(click)="restartDb.set(!restartDb())"
									(keydown.enter)="restartDb.set(!restartDb())"
								>
									<i aria-hidden="true"></i>
									<span>
										Restart the database now for a new keyfile · about 20 s, back-in-a-moment page
									</span>
								</div>
							}
							<span class="rc-label">What runs</span>
							<p class="rc-note rc-mono">
								deploy.yml · rotate = true{{ restartDb() ? ' · restart_database = true' : '' }}
							</p>
							<p class="rc-note rc-mono">
								→ release {{ d.target }} --rotate{{ restartDb() ? ' --restart-database' : '' }}
							</p>
							<p class="rc-note">
								If any change fails, every value goes back to the old one and the old release keeps
								serving.
							</p>
						} @else {
							<div
								class="do-tick"
								aria-disabled="true"
							>
								<i aria-hidden="true"></i>
								<span>
									Nothing to rotate. Changes made under Run › Secrets › Rotate show here, ticked, with
									what each one does.
								</span>
							</div>
						}
						@if (rotateIds().length || (d.target === 'production' && allowed().length)) {
							<div class="rc-form">
								<label>
									Type {{ environment() }}
									<div class="rc-msearch">
										<input
											type="text"
											autocomplete="off"
											[attr.aria-label]="'Type ' + environment() + ' to confirm'"
											[value]="confirmText()"
											(input)="confirmText.set($any($event.target).value)"
										/>
									</div>
								</label>
							</div>
						}
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
									[disabled]="!pinReady() || busy() || running() || needsConfirm()"
								>
									{{ rotateIds().length ? 'Deploy and rotate' : 'Start the deploy' }}
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
			<rc-loading what="Reading the deploy runs from GitHub…" />
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
	/**
	 * Required values blank in this environment (owner, 21 Nov): read names-only when the tab opens.
	 * Only /api names can be allowed blank; other folders hold infrastructure the server cannot start without.
	 */
	protected readonly blanks = injectQuery(() => ({
		queryKey: ['blanks', this.ctx.projectId(), this.ctx.repoId(), this.environment()],
		queryFn: () =>
			this.api.secrets({
				projectId: this.ctx.projectId() ?? '',
				repositoryId: this.ctx.repoId() ?? '',
				environment: this.environment(),
			}),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
		refetchOnMount: 'always' as const,
	}));
	protected readonly blankSplit = computed(() => requiredBlanks(this.blanks.data()?.folders ?? []));
	protected readonly blankCount = computed(() => this.blankSplit().offered.length + this.blankSplit().never.length);
	protected readonly placeName = computed(() => {
		const b = this.blanks.data();
		return b ? `${b.project} · ${b.environment}` : this.environment();
	});
	protected readonly allowed = signal<string[]>([]);
	protected readonly blankQuery = signal('');
	protected readonly blankOpen = signal(false);
	protected readonly confirmText = signal('');
	private readonly matches = (n: string) => n.toLowerCase().includes(this.blankQuery().trim().toLowerCase());
	protected readonly offered = computed(() =>
		this.blankSplit().offered.filter((n) => !this.allowed().includes(n) && this.matches(n)),
	);
	protected readonly neverShown = computed(() => this.blankSplit().never.filter((x) => this.matches(x.name)));
	protected readonly effects = computed(() => blankEffects(this.allowed()));
	/**
	 * Rotation asks for the environment's name typed (Release Path brief Q6), and production with
	 * allowed blanks does too (the API checks both).
	 */
	protected readonly needsConfirm = computed(() => {
		const a = this.view.data();
		if (a?.state !== 'ok') return false;
		const asks = this.rotateIds().length > 0 || (a.data.target === 'production' && this.allowed().length > 0);
		return asks && this.confirmText().trim() !== this.environment();
	});
	/** The environment's DigitalOcean slot, for the reachable card's address. */
	private readonly slot = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.environment())?.cloudId ?? '',
	);
	/** Reachable through Cloudflare, read once the newest run has finished (Release Path brief C8). */
	protected readonly reach = injectQuery(() => {
		const a = this.view.data();
		const run = a?.state === 'ok' ? a.data.run : null;
		return {
			queryKey: ['reachable', this.ctx.projectId(), this.ctx.repoId(), this.environment(), run?.id ?? 0],
			queryFn: () =>
				this.api.reachable(
					this.ctx.projectId() ?? '',
					this.ctx.repoId() ?? '',
					this.slot(),
					this.environment(),
				),
			enabled: !!run && run.status === 'completed' && !!this.slot(),
			staleTime: 60_000,
		};
	});
	protected readonly cardPin = signal('');
	protected readonly cardConfirm = signal('');
	protected readonly pinLength = PIN_LENGTH;
	protected allReachable(checks: { ok: boolean | null }[]): boolean {
		return checks.every((c) => c.ok === true);
	}
	protected hasFix(checks: { fix: string | null }[]): boolean {
		return checks.some((c) => c.fix === 'origin-pulls');
	}
	/** The newest release tag made at or after the newest run started. */
	protected recordedTag(d: ServerDeployView): string | null {
		if (!d.run || d.run.conclusion !== 'success') return null;
		const from = Date.parse(d.run.createdAt) - 60_000;
		return d.tags.find((t) => Date.parse(t.at) >= from)?.name ?? null;
	}
	protected async fixOriginPulls(): Promise<void> {
		await this.act(async () => {
			await this.api.fixReachable(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.slot(),
				this.environment(),
				this.cardPin(),
			);
			await this.reach.refetch();
		}, 'Origin pulls are on again for every host.');
	}
	protected async rollback(): Promise<void> {
		await this.act(
			() =>
				this.api.startServerDeploy(
					this.ctx.projectId() ?? '',
					this.ctx.repoId() ?? '',
					this.environment(),
					this.cardPin(),
					[],
					this.cardConfirm().trim() || undefined,
					undefined,
					{ action: 'rollback' },
				),
			'Rolling back: the server swaps the previous release back in.',
		);
	}
	/** What rotations left waiting for a deploy with rotation (names only), read with the view. */
	protected readonly rotation = injectQuery(() => ({
		queryKey: ['rotation', this.ctx.projectId(), this.ctx.repoId(), this.environment()],
		queryFn: () => this.api.rotation(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.environment()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId(),
	}));
	/** Values the server refused, added with "Deploy again with rotation". */
	private readonly refused = signal<RotateId[]>([]);
	protected readonly rotateIds = computed(() => [
		...new Set([...(this.rotation.data()?.state.pending ?? []), ...this.refused()]),
	]);
	protected readonly rotateRows = computed(() => rotateRowsOf(this.rotateIds()));
	protected readonly restartDb = signal(false);
	/** The refused data-service files in words ("Redis password, database keyfile"). */
	protected refusedLabel(names: string[]): string {
		const text = names.map((n) => DATA_SECRET_LABELS[n] ?? n).join(', ');
		return text.charAt(0).toUpperCase() + text.slice(1);
	}
	/** Deploy again with rotation: the refused values are ticked; the name and PIN still confirm it. */
	protected rotateAgain(names: string[]): void {
		this.refused.set(names.map((n) => DATA_FILE_IDS[n]).filter((x): x is RotateId => !!x));
		this.message.set(`Type ${this.environment()} and your PIN, then Deploy and rotate.`);
	}
	private readonly router = inject(Router);
	protected go(screen: string, tab: string): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'r', this.ctx.repoId(), screen], {
			queryParams: { tab },
		});
	}
	protected allowAll(): void {
		this.allowed.set([...new Set([...this.allowed(), ...this.blankSplit().offered])]);
	}
	protected allow(name: string): void {
		const add = togetherWith(name, this.blankSplit().offered);
		this.allowed.update((a) => [...new Set([...a, ...add])]);
		this.blankQuery.set('');
	}
	protected unallow(name: string): void {
		const drop = togetherWith(name, this.blankSplit().offered);
		this.allowed.update((a) => a.filter((n) => !drop.includes(n)));
	}
	/** This run's branch on a development server; empty means its saved branch. */
	protected readonly pickedBranch = signal('');
	protected picksBranch(target: string | null): boolean {
		return !!target && BRANCH_PICKED_TARGETS.includes(target as ServerTarget);
	}
	private readonly refreshNext = signal(false);
	protected readonly branches = injectQuery(() => {
		const a = this.view.data();
		const repository = this.ctx.repo()?.sourceCode.repository ?? '';
		return {
			queryKey: ['server-branches', repository],
			queryFn: () => this.api.repositoryBranches(repository, this.refreshNext()),
			enabled: a?.state === 'ok' && this.picksBranch(a.data.target) && !!repository,
			staleTime: 60_000,
		};
	});
	protected async refreshBranches(): Promise<void> {
		this.refreshNext.set(true);
		await this.branches.refetch();
		this.refreshNext.set(false);
	}
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
						.replace(/^Roll back .*/, 'rollback')
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
					this.allowed(),
					this.confirmText() || undefined,
					this.pickedBranch() || undefined,
					this.rotateIds().length
						? { rotate: true, restartDatabase: this.rotateIds().includes('keyfile') && this.restartDb() }
						: {},
				),
			'Started. GitHub shows the run in a few seconds; the deploy job then waits for your approval here.',
		);
		this.refused.set([]);
		void this.rotation.refetch();
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

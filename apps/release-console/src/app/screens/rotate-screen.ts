import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { GRACE_DAYS, ROTATE_ROWS, type RotateId, rotateRowsOf } from '@saha-textile/release-console-contracts';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { when } from '../pages/format-time';
import { Icon } from '../shared/icons';
import { Loading } from '../shared/loading';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

/**
 * Run › Secrets › Rotate (Release Path brief 3.1, approved 23 Nov): pick the values to change, on a
 * schedule (old sign-in, CSRF and mailbox keys kept 30 days, nobody signed out) or after a leak (old
 * keys dropped now). New values are made on the owner's Mac and written into Infisical by the
 * Infisical chat's script; the database, Redis and search values then go to the server with Live
 * deploy's "Deploy and rotate". The console keeps names and dates only.
 */
@Component({
	selector: 'rc-rotate-screen',
	imports: [Icon, Loading, PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (view.data(); as v) {
			@if (!v.tier) {
				<div class="rc-banner small">
					<span class="rc-dot"></span>
					<div>
						<b>{{ envLabel() }} has no server tier in Infisical to rotate.</b>
						Rotation is for an environment that runs on a server and reads its secrets from one of the name
						list's tiers (development, staging or production). This computer's values come from the local
						setup.
					</div>
				</div>
			} @else {
				@if (v.state.pending.length) {
					<div class="rc-banner amber small">
						<span class="rc-dot amber"></span>
						<div>
							<b>Waiting for a deploy with rotation:</b>
							{{ labels(v.state.pending) }}. Changed in Infisical {{ when(v.state.pendingAt ?? '') }}; the
							server still runs the old values until Live deploy's Deploy and rotate.
						</div>
						<button
							type="button"
							class="rc-btn primary"
							(click)="openDeploy()"
						>
							Live deploy
						</button>
					</div>
				}
				@if (v.graceDaysLeft !== null) {
					<div
						class="rc-banner small"
						[class.amber]="v.graceDaysLeft <= 0"
					>
						<span
							class="rc-dot"
							[class.amber]="v.graceDaysLeft <= 0"
						></span>
						<div>
							<b>
								{{
									v.graceDaysLeft <= 0
										? 'The old keys have been kept ' + graceDays + ' days: remove them now.'
										: 'Old keys are kept ' + v.graceDaysLeft + ' more days.'
								}}
							</b>
							{{ v.state.graceNames.join(', ') }}, since {{ when(v.state.graceAt ?? '') }}. Removing them
							blanks these names; the next deploy then carries it.
						</div>
						<button
							type="button"
							class="rc-btn"
							[disabled]="!pinReady() || busy()"
							(click)="clearPrevious()"
						>
							Remove the old keys
						</button>
					</div>
				}
				<div class="rc-g2">
					<div class="rc-panel">
						<span class="rc-label">Why</span>
						<div
							class="do-tick"
							role="radio"
							tabindex="0"
							[attr.aria-checked]="grace()"
							[class.on]="grace()"
							(click)="grace.set(true)"
							(keydown.enter)="grace.set(true)"
						>
							<i aria-hidden="true"></i>
							<span>On a schedule: keep old keys for {{ graceDays }} days, nobody signed out</span>
						</div>
						<div
							class="do-tick"
							role="radio"
							tabindex="0"
							[attr.aria-checked]="!grace()"
							[class.on]="!grace()"
							(click)="grace.set(false)"
							(keydown.enter)="grace.set(false)"
						>
							<i aria-hidden="true"></i>
							<span>After a leak: drop old keys now</span>
						</div>
					</div>
					<div class="rc-panel">
						<span class="rc-label">Last changed</span>
						@if (v.state.lastAt) {
							<span class="rc-mono">
								{{ v.state.lastChanged.length }}
								{{ v.state.lastChanged.length === 1 ? 'name' : 'names' }} · {{ when(v.state.lastAt) }}
							</span>
							<span class="rc-note">{{ v.state.lastChanged.join(', ') }}</span>
						} @else {
							<span class="rc-mono">not recorded</span>
							<span class="rc-note">
								Changes made from this console are listed here, names only; values changed elsewhere
								show as not recorded.
							</span>
						}
					</div>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th></th>
								<th>Value</th>
								<th>What happens</th>
							</tr>
						</thead>
						<tbody>
							@for (r of rows; track r.key) {
								<tr>
									<td>
										<div
											class="do-tick"
											role="checkbox"
											tabindex="0"
											[attr.aria-label]="r.label"
											[attr.aria-checked]="picked().includes(r.key)"
											[class.on]="picked().includes(r.key)"
											(click)="toggle(r.key)"
											(keydown.enter)="toggle(r.key)"
										>
											<i aria-hidden="true"></i>
										</div>
									</td>
									<td>{{ r.label }}</td>
									<td
										[class.ok]="r.tone === 'ok' && grace()"
										[class.amber]="r.tone === 'amber' || (!grace() && r.scheduled !== r.leak)"
									>
										{{ grace() ? r.scheduled : r.leak }}
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<form
					class="rc-banner cy"
					(submit)="$event.preventDefault(); make()"
				>
					<span class="rc-dot cy"></span>
					<div>
						New values are made on your Mac and written into Infisical. Copy them into NordPass afterwards:
						Infisical's free plan keeps no history. The old values stay on the server until the deploy
						succeeds.
						<div class="rc-form">
							<label>
								Type {{ envName() }}
								<div class="rc-msearch">
									<input
										type="text"
										autocomplete="off"
										[attr.aria-label]="'Type ' + envName() + ' to confirm'"
										[value]="confirmText()"
										(input)="confirmText.set($any($event.target).value)"
									/>
								</div>
							</label>
							<label>
								PIN
								<rc-pin-boxes
									label="Console PIN to rotate secrets"
									[autofocus]="false"
									[disabled]="busy()"
									(changed)="pin.set($event)"
								/>
							</label>
						</div>
					</div>
					<button
						type="submit"
						class="rc-btn primary"
						[disabled]="!ids().length || !pinReady() || confirmText().trim() !== envName() || busy()"
					>
						<rc-icon name="tabler/key" />
						{{ busy() ? 'Making new values…' : 'Make new values' }}
					</button>
				</form>
				@if (message()) {
					<p class="rc-note">{{ message() }}</p>
				}
			}
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>The rotation record could not be read.</b>
					{{ view.error().message }}
				</div>
			</div>
		} @else {
			<rc-loading what="Reading this environment's rotations…" />
		}
	`,
})
export class RotateScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	private readonly router = inject(Router);
	private readonly queries = inject(QueryClient);
	private readonly pins = viewChild(PinBoxes);
	protected readonly when = when;
	protected readonly rows = ROTATE_ROWS;
	protected readonly graceDays = GRACE_DAYS;
	protected readonly envName = computed(() => this.state.environment());
	protected readonly envLabel = computed(
		() => this.ctx.repo()?.environments.find((e) => e.name === this.envName())?.label ?? this.envName(),
	);
	protected readonly grace = signal(true);
	protected readonly picked = signal<string[]>([]);
	protected readonly ids = computed(
		() =>
			[
				...new Set(ROTATE_ROWS.filter((r) => this.picked().includes(r.key)).flatMap((r) => [...r.ids])),
			] as RotateId[],
	);
	protected readonly confirmText = signal('');
	protected readonly pin = signal('');
	protected readonly pinReady = computed(() => this.pin().length === PIN_LENGTH);
	protected readonly busy = signal(false);
	protected readonly message = signal('');

	protected readonly view = injectQuery(() => ({
		queryKey: ['rotation', this.ctx.projectId(), this.ctx.repoId(), this.envName()],
		queryFn: () => this.api.rotation(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.envName()),
		enabled: !!this.ctx.projectId() && !!this.ctx.repoId() && !!this.envName(),
	}));

	protected labels(ids: string[]): string {
		return rotateRowsOf(ids)
			.map((r) => r.label)
			.join(', ');
	}
	protected toggle(key: string): void {
		this.picked.update((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
	}
	protected openDeploy(): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'r', this.ctx.repoId(), 'deploy'], {
			queryParams: { tab: this.envName() },
		});
	}

	protected async make(): Promise<void> {
		await this.act(async () => {
			const v = await this.api.rotate(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.envName(), {
				pin: this.pin(),
				confirm: this.confirmText().trim(),
				ids: this.ids(),
				grace: this.grace(),
			});
			this.picked.set([]);
			this.confirmText.set('');
			return v.state.pending.length
				? `Written into Infisical: ${v.state.lastChanged.join(', ')}. Copy them into NordPass now, then use Live deploy's Deploy and rotate.`
				: `Written into Infisical: ${v.state.lastChanged.join(', ')}. Copy them into NordPass now; the next deploy carries them.`;
		});
	}

	protected async clearPrevious(): Promise<void> {
		await this.act(async () => {
			await this.api.clearPreviousKeys(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.envName(),
				this.pin(),
			);
			return 'The old keys are blanked in Infisical; the next deploy carries the change.';
		});
	}

	private async act(call: () => Promise<string>): Promise<void> {
		this.busy.set(true);
		this.message.set('');
		try {
			this.message.set(await call());
			await this.queries.invalidateQueries({ queryKey: ['rotation'] });
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
			this.pins()?.clear();
		}
	}
}

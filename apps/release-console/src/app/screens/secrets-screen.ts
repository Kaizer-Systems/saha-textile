import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { Icon, environmentIcon } from '../shared/icons';

import type { SecretState, SecretTier, SecretsView } from '@saha-textile/release-console-contracts';

type Row = SecretsView['folders'][number]['rows'][number];

const FOLDER_ICONS: Record<string, string> = {
	api: 'tabler/server',
	backup: 'tabler/device-floppy',
	infrastructure: 'tabler/topology-star-3',
	deployment: 'tabler/rocket',
	'release-console': 'tabler/layout-grid',
	'github-actions': 'tabler/route-2',
};

/**
 * The Infisical tier a console environment reads (owner, 20 Nov): this computer and dev read the dev
 * project, staging the staging project, production the production project; anything else has none.
 */
export function tierOf(name: string, onThisComputer: boolean): SecretTier | null {
	if (/prod/i.test(name)) return 'production';
	if (/stag/i.test(name)) return 'staging';
	if (onThisComputer || /^(local|dev)/i.test(name)) return 'dev';
	return null;
}

/** A row's dot colour and word. */
function stateOf(state: SecretState, row: Row): { cls: string; word: string } {
	switch (state) {
		case 'set':
			return { cls: 'ok', word: 'set' };
		case 'empty':
			return row.optional ? { cls: '', word: 'empty · may stay' } : { cls: 'amber', word: 'empty' };
		case 'missing':
			return row.optional ? { cls: '', word: 'not added · may stay' } : { cls: 'red', word: 'missing' };
		default:
			return { cls: '', word: 'not read' };
	}
}

/** A row that needs the owner: a name without a value that is not allowed to stay empty. */
const needsOwner = (row: Row) => !row.optional && row.state !== 'set';

/**
 * Run › Secrets: the names in the chosen environment's own Infisical project and environment, per
 * folder, set, empty or missing, never a value. Read through the Mac helper with the owner's
 * Infisical login, only for the environment that is open; the CLI gives no change dates.
 */
@Component({
	selector: 'rc-secrets-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (tier(); as t) {
			<div class="rc-row between">
				<span class="rc-label">
					<rc-icon [name]="tierIcon()" />
					Infisical · {{ view.data()?.project ?? project(t) }} ·
					{{ view.data()?.environment ?? t }}
				</span>
				<button
					type="button"
					class="rc-btn"
					[disabled]="view.isFetching()"
					(click)="fresh()"
				>
					<rc-icon name="tabler/history" />
					{{ view.isFetching() ? 'Reading Infisical…' : 'Read again' }}
				</button>
			</div>
			<p class="rc-note">
				Names only: values are dropped inside the Infisical reader and never reach the console. Infisical’s
				command line gives no change dates, so none are shown.
			</p>
			@if (view.data(); as v) {
				@for (e of v.errors; track e.folder) {
					<div class="rc-banner red small">
						<span class="rc-dot red"></span>
						<div>
							<b>/{{ e.folder }} could not be read.</b>
							{{ e.message }} If the login has expired, run
							<code>infisical login</code>
							in a terminal, then Read again.
						</div>
					</div>
				}
				@if (tab() === 'problem') {
					<div
						class="rc-banner small"
						[class.red]="problems() > 0"
						[class.ok]="problems() === 0"
					>
						<span
							class="rc-dot"
							[class.red]="problems() > 0"
							[class.ok]="problems() === 0"
						></span>
						<div>
							@if (problems()) {
								<b>
									{{ problems() }} name{{ problems() === 1 ? '' : 's' }} need a value in
									{{ v.project }}.
								</b>
								Add each in Infisical under the same name; a missing value stops this environment’s
								release.
							} @else {
								<b>Every expected name has a value in {{ v.project }}.</b>
							}
						</div>
					</div>
				}
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Name (values never shown)</th>
								<th>In {{ v.project }} · {{ v.environment }}</th>
							</tr>
						</thead>
						<tbody>
							@for (f of shown(); track f.folder) {
								<tr>
									<td colspan="2">
										<span class="rc-subl">
											<rc-icon [name]="folderIcon(f.folder)" />
											/{{ f.folder }} · {{ f.rows.length }} names
										</span>
									</td>
								</tr>
								@for (r of f.rows; track r.name) {
									@let c = stateOfRow(r);
									<tr>
										<td>
											<span class="rc-mono">{{ r.name }}</span>
											@if (!r.expected) {
												<span class="rc-pill muted">not in the name list</span>
											}
											@if (r.devOnly) {
												<span class="rc-pill cy">dev only</span>
											}
										</td>
										<td>
											<span
												class="rc-dot"
												[class.ok]="c.cls === 'ok'"
												[class.amber]="c.cls === 'amber'"
												[class.red]="c.cls === 'red'"
											></span>
											<span
												[class.red]="c.cls === 'red'"
												[class.amber]="c.cls === 'amber'"
												[class.muted]="!c.cls"
											>
												{{ c.word }}
											</span>
										</td>
									</tr>
								}
							}
						</tbody>
					</table>
				</div>
				<p class="rc-note">
					Read {{ readAt(v.at) }} with your login, kept for a minute. Switch the environment at the top to see
					another Infisical project. The expected names come from
					<code>docker/infisical/variable-names.json</code>
					.
				</p>
			} @else if (view.isError()) {
				<div class="rc-banner red small">
					<span class="rc-dot red"></span>
					<div>
						<b>Infisical could not be read.</b>
						{{ view.error().message }} Check that the Mac helper answers (Watch › Health) and that
						<code>infisical login</code>
						is current.
					</div>
				</div>
			} @else {
				<p class="rc-p muted">Reading {{ project(t) }} with your login; this takes a few seconds…</p>
			}
		} @else {
			<div class="rc-banner amber small">
				<span class="rc-dot amber"></span>
				<div>
					<b>This environment has no Infisical project in the inventory.</b>
					The dev, staging and production environments each read their own project.
				</div>
			</div>
		}
	`,
})
export class SecretsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	readonly tab = input('matrix');
	private readonly fresher = signal(false);

	/** The open environment's tier; switching the environment tab switches the Infisical project read. */
	protected readonly tier = computed(() => {
		const name = this.state.environment();
		const env = this.ctx.environments().find((e) => e.name === name);
		return tierOf(name, env ? env.cloudId === null : false);
	});
	protected readonly view = injectQuery(() => ({
		queryKey: ['secrets', this.tier()],
		queryFn: () => this.api.secrets(this.tier() ?? 'dev', this.fresher()),
		enabled: this.tier() !== null,
		staleTime: 60_000,
	}));
	protected readonly shown = computed(() => {
		const folders = this.view.data()?.folders ?? [];
		if (this.tab() !== 'problem') return folders;
		return folders.map((f) => ({ ...f, rows: f.rows.filter(needsOwner) })).filter((f) => f.rows.length);
	});
	protected readonly problems = computed(() =>
		(this.view.data()?.folders ?? []).reduce((n, f) => n + f.rows.filter(needsOwner).length, 0),
	);
	protected readonly tierIcon = computed(() => {
		const t = this.tier();
		return environmentIcon(t ?? 'dev', t === 'dev');
	});

	protected project(tier: SecretTier): string {
		return `saha-textile-${tier}`;
	}
	protected stateOfRow(row: Row) {
		return stateOf(row.state, row);
	}
	protected folderIcon(folder: string): string {
		return FOLDER_ICONS[folder] ?? 'tabler/folder';
	}
	protected readAt(iso: string): string {
		return new Date(iso).toLocaleString('en-IN', { timeStyle: 'short', dateStyle: 'medium' });
	}
	protected fresh(): void {
		this.fresher.set(true);
		void this.view.refetch().finally(() => this.fresher.set(false));
	}
}

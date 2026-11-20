import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { Icon, environmentIcon } from '../shared/icons';

import type { SecretCell, SecretsView } from '@saha-textile/release-console-contracts';

type Row = SecretsView['folders'][number]['rows'][number];

const FOLDER_ICONS: Record<string, string> = {
	api: 'tabler/server',
	backup: 'tabler/device-floppy',
	infrastructure: 'tabler/topology-star-3',
	deployment: 'tabler/rocket',
	'release-console': 'tabler/layout-grid',
	'github-actions': 'tabler/route-2',
};

/** A cell's dot colour and word. */
function cellOf(state: SecretCell, row: Row): { cls: string; word: string } {
	switch (state) {
		case 'set':
			return { cls: 'ok', word: 'set' };
		case 'empty':
			return row.optional ? { cls: '', word: 'empty · may stay' } : { cls: 'amber', word: 'empty' };
		case 'missing':
			return row.optional ? { cls: '', word: 'not added · may stay' } : { cls: 'red', word: 'missing' };
		case 'unknown':
			return { cls: '', word: 'not read' };
		default:
			return { cls: '', word: '—' };
	}
}

/** A row that needs the owner: an expected name missing or empty somewhere it is used. */
const needsOwner = (row: Row) =>
	!row.optional && Object.values(row.cells).some((c) => c === 'missing' || c === 'empty' || c === 'unknown');

/**
 * Run › Secrets: every name in Infisical per tier and folder, set, empty or missing, never a value.
 * Read through the Mac helper with the owner's Infisical login; the CLI gives no change dates.
 */
@Component({
	selector: 'rc-secrets-screen',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-note">
				Names only: values are dropped inside the Infisical reader and never reach the console. Infisical’s
				command line gives no change dates, so none are shown.
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
		@if (view.data(); as v) {
			@for (e of v.errors; track e.tier + e.folder) {
				<div class="rc-banner red small">
					<span class="rc-dot red"></span>
					<div>
						<b>{{ e.tier }} · /{{ e.folder }} could not be read.</b>
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
							<b>{{ problems() }} name{{ problems() === 1 ? '' : 's' }} need a value.</b>
							A missing value in staging or production stops that tier’s release; add it in Infisical
							under the same name.
						} @else {
							<b>Every expected name has a value.</b>
						}
					</div>
				</div>
			}
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Name (values never shown)</th>
							@for (t of v.tiers; track t.tier) {
								<th>
									<rc-icon [name]="tierIcon(t.tier)" />
									{{ t.tier }}
									<span class="rc-mono">· {{ t.environment }}</span>
								</th>
							}
						</tr>
					</thead>
					<tbody>
						@for (f of shown(); track f.folder) {
							<tr>
								<td [attr.colspan]="v.tiers.length + 1">
									<span class="rc-subl">
										<rc-icon [name]="folderIcon(f.folder)" />
										/{{ f.folder }} · {{ f.rows.length }} names
									</span>
								</td>
							</tr>
							@for (r of f.rows; track r.name) {
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
									@for (t of v.tiers; track t.tier) {
										@let c = cell(r, t.tier);
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
									}
								</tr>
							}
						}
					</tbody>
				</table>
			</div>
			<p class="rc-note">
				Read {{ readAt(v.at) }} from Infisical (the three tier projects, with your login), kept for a minute.
				The expected names come from
				<code>docker/infisical/variable-names.json</code>
				.
			</p>
		} @else if (view.isError()) {
			<div class="rc-banner red small">
				<span class="rc-dot red"></span>
				<div>
					<b>Infisical could not be read.</b>
					{{ view.error().message }} Check that the Mac helper answers (Run › Health) and that
					<code>infisical login</code>
					is current.
				</div>
			</div>
		} @else {
			<p class="rc-p muted">Reading Infisical with your login; this takes up to a minute…</p>
		}
	`,
})
export class SecretsScreen {
	private readonly api = inject(ConsoleApi);
	readonly tab = input('matrix');
	private readonly fresher = signal(false);
	protected readonly view = injectQuery(() => ({
		queryKey: ['secrets'],
		queryFn: () => this.api.secrets(this.fresher()),
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

	protected cell(row: Row, tier: string) {
		return cellOf(row.cells[tier] ?? 'not-here', row);
	}
	protected tierIcon(tier: string): string {
		return environmentIcon(tier === 'production' ? 'production' : tier, tier === 'dev');
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

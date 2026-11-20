import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { SecretDrafts } from '../data/secret-drafts';
import { Icon, environmentIcon } from '../shared/icons';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

import type { SaveSecretsResult, SecretState, SecretTier, SecretsView } from '@saha-textile/release-console-contracts';

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
 * folder, set, empty or missing, never a value; read with the owner's Infisical login only for the
 * open environment. Write mode (owner, 20 Nov, brief MFanevSoVvWE25WMCJsPLn): a new value typed in a
 * row waits as a draft; the counter shows how many; one Save sends them all after one PIN, and
 * staging and production also need the environment's name typed.
 */
@Component({
	selector: 'rc-secrets-screen',
	imports: [Icon, PinBoxes],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(window:beforeunload)': 'unsaved($event)' },
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
			@for (r of results(); track r.folder) {
				<div
					class="rc-banner small"
					[class.ok]="r.saved"
					[class.red]="!r.saved"
				>
					<span
						class="rc-dot"
						[class.ok]="r.saved"
						[class.red]="!r.saved"
					></span>
					<div>
						@if (r.saved) {
							<b>/{{ r.folder }}: {{ r.names.length }} saved</b>
							({{ r.names.join(', ') }}). The list has been read again.
						} @else {
							<b>/{{ r.folder }}: not saved.</b>
							{{ r.error }} Its drafts are still here; if the login has expired, run
							<code>infisical login</code>
							, then Save again.
						}
					</div>
				</div>
			}
			@if (waiting().length) {
				<div class="rc-banner cy">
					<span class="rc-dot cy"></span>
					<div>
						<b>{{ waiting().length }} change{{ waiting().length === 1 ? '' : 's' }} waiting</b>
						in {{ project(t) }} · {{ view.data()?.environment ?? t }}. Nothing is saved yet.
					</div>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="discardAll(t)"
					>
						Discard all
					</button>
					<button
						type="button"
						class="rc-btn primary"
						(click)="openSave()"
					>
						Save {{ waiting().length }} change{{ waiting().length === 1 ? '' : 's' }}
					</button>
				</div>
			}
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
								Type each new value in its row and Save; a missing value stops this environment’s
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
								<th></th>
							</tr>
						</thead>
						<tbody>
							@for (f of shown(); track f.folder) {
								<tr>
									<td colspan="3">
										<span class="rc-subl">
											<rc-icon [name]="folderIcon(f.folder)" />
											/{{ f.folder }} · {{ f.rows.length }} names
										</span>
									</td>
								</tr>
								@for (r of f.rows; track r.name) {
									@let c = stateOfRow(r);
									@let d = { tier: t, folder: f.folder, name: r.name };
									@let draft = drafts.value(d);
									<tr [class.sel]="!!draft">
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
											@if (drafts.isOpen(d)) {
												<div class="rc-row">
													<div class="rc-msearch">
														<input
															type="password"
															autocomplete="new-password"
															spellcheck="false"
															[attr.aria-label]="'New value for ' + r.name"
															[value]="draft"
															(input)="type(d, $any($event.target).value)"
														/>
													</div>
													@if (draft) {
														<span class="rc-pill amber">draft</span>
													}
												</div>
											} @else {
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
											}
										</td>
										<td>
											@if (drafts.isOpen(d)) {
												<button
													type="button"
													class="rc-btn ghost"
													(click)="drafts.undo(d)"
												>
													<rc-icon name="tabler/arrow-back-up" />
													Undo
												</button>
											} @else if (r.writable) {
												<button
													type="button"
													class="rc-btn ghost"
													(click)="drafts.edit(d)"
												>
													<rc-icon name="tabler/pencil" />
													New value
												</button>
											} @else {
												<span class="rc-note">not editable</span>
											}
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

			@if (saving()) {
				<div class="rc-modal-back">
					<form
						class="rc-modal"
						(submit)="save($event, t)"
					>
						<h3 class="rc-h">
							Save {{ waiting().length }} change{{ waiting().length === 1 ? '' : 's' }} in
							{{ project(t) }} ·
							{{ view.data()?.environment ?? t }}
						</h3>
						<div class="rc-kv">
							@for (g of groups(); track g.folder) {
								<div>
									<span>
										<rc-icon [name]="folderIcon(g.folder)" />
										/{{ g.folder }}
									</span>
									<em>{{ g.names.join(', ') }}</em>
								</div>
							}
						</div>
						<div class="rc-banner red small">
							<span class="rc-dot red"></span>
							<div>
								<b>This replaces the old values for good.</b>
								Infisical’s free plan keeps no history, so save each new value in NordPass first.
							</div>
						</div>
						@if (t !== 'dev') {
							<p class="rc-p">
								Type
								<button
									type="button"
									class="rc-chip"
									[attr.data-tip]="copied() ? 'Copied' : 'Click to copy'"
									(click)="copy(t)"
								>
									{{ t }}
								</button>
								to confirm.
							</p>
							<div class="rc-msearch">
								<input
									type="text"
									autocomplete="off"
									spellcheck="false"
									aria-label="The environment's name"
									[value]="confirmName()"
									(input)="confirmName.set($any($event.target).value)"
								/>
							</div>
						}
						<div class="rc-form">
							<label>
								PIN
								<rc-pin-boxes
									label="Console PIN to save"
									[disabled]="busy()"
									(changed)="pin.set($event)"
								/>
							</label>
						</div>
						@if (message()) {
							<p class="rc-note red">{{ message() }}</p>
						}
						<div class="rc-row end">
							<button
								type="button"
								class="rc-btn ghost"
								[disabled]="busy()"
								(click)="closeSave()"
							>
								Cancel
							</button>
							<button
								type="submit"
								class="rc-btn primary"
								[disabled]="!ready(t)"
							>
								{{
									busy()
										? 'Saving…'
										: 'Save ' + waiting().length + ' change' + (waiting().length === 1 ? '' : 's')
								}}
							</button>
						</div>
					</form>
				</div>
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
	protected readonly drafts = inject(SecretDrafts);
	private readonly pins = viewChild(PinBoxes);
	readonly tab = input('matrix');
	private readonly fresher = signal(false);
	protected readonly saving = signal(false);
	protected readonly busy = signal(false);
	protected readonly pin = signal('');
	protected readonly confirmName = signal('');
	protected readonly message = signal('');
	protected readonly copied = signal(false);
	protected readonly results = signal<SaveSecretsResult['results']>([]);

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
	/** This tier's drafts that hold a value. */
	protected readonly waiting = computed(() => {
		const t = this.tier();
		return t ? this.drafts.of(t) : [];
	});
	/** The drafts by folder, names only, for the Save dialog. */
	protected readonly groups = computed(() => {
		const out = new Map<string, string[]>();
		for (const d of this.waiting()) out.set(d.folder, [...(out.get(d.folder) ?? []), d.name]);
		return [...out.entries()].map(([folder, names]) => ({ folder, names: names.sort() }));
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
	protected type(d: { tier: SecretTier; folder: string; name: string }, value: string): void {
		this.drafts.set({ ...d, value });
	}
	protected discardAll(tier: SecretTier): void {
		this.drafts.drop(tier);
	}
	protected openSave(): void {
		this.message.set('');
		this.confirmName.set('');
		this.pin.set('');
		this.saving.set(true);
	}
	protected closeSave(): void {
		this.saving.set(false);
	}
	/** Copies the environment's name, so typing it is a paste; the hint says Copied for a moment. */
	protected copy(tier: SecretTier): void {
		const done = () => {
			this.copied.set(true);
			setTimeout(() => this.copied.set(false), 1500);
		};
		// Some browser views refuse the clipboard API; a selected text box and the copy command still work there.
		const fallback = () => {
			const box = document.createElement('textarea');
			box.value = tier;
			box.setAttribute('readonly', '');
			box.style.position = 'fixed';
			box.style.opacity = '0';
			document.body.append(box);
			box.select();
			const ok = document.execCommand('copy');
			box.remove();
			if (ok) done();
		};
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(tier).then(done, fallback);
		else fallback();
	}
	protected ready(tier: SecretTier): boolean {
		const named = tier === 'dev' || this.confirmName().trim().toLowerCase() === tier;
		return named && this.pin().length === PIN_LENGTH && !this.busy() && this.waiting().length > 0;
	}

	protected async save(e: Event, tier: SecretTier): Promise<void> {
		e.preventDefault();
		if (!this.ready(tier)) return;
		this.busy.set(true);
		this.message.set('');
		try {
			const answer = await this.api.saveSecrets({
				tier,
				projectId: this.ctx.projectId(),
				pin: this.pin(),
				confirmName: this.confirmName(),
				changes: this.waiting().map(({ folder, name, value }) => ({ folder, name, value })),
			});
			for (const r of answer.results) if (r.saved) this.drafts.drop(tier, r.folder);
			this.results.set(answer.results);
			this.saving.set(false);
			this.fresh();
		} catch (err) {
			this.message.set((err as Error).message);
			this.pins()?.clear();
		} finally {
			this.busy.set(false);
		}
	}

	/** Leaving the page would lose the drafts, so the browser asks first while any wait. */
	protected unsaved(e: BeforeUnloadEvent): void {
		if (this.drafts.count() > 0) e.preventDefault();
	}
}

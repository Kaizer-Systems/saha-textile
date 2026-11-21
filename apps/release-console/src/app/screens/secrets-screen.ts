import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { formatSecretsPlace, secretsSourceOf } from '@saha-textile/release-console-contracts';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { ConsoleState } from '../data/console-state';
import { SecretDrafts } from '../data/secret-drafts';
import { Icon, environmentIcon } from '../shared/icons';
import { Loading } from '../shared/loading';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';
import { VendorLogo } from '../shared/vendor-logo';

import type {
	Repository,
	SaveSecretsResult,
	SecretState,
	SecretTier,
	SecretsSlot,
	SecretsView,
} from '@saha-textile/release-console-contracts';

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
 * The name-list tier an environment's name suggests, used only to offer filling in its place in one
 * click: this computer and dev suggest the dev project, staging the staging project, production the
 * production project; anything else suggests none. What a tab reads comes from its own setting.
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
 * Run › Secrets: the names in the open environment's own place, per folder, set, empty or missing,
 * never a value; read with the owner's Infisical login only for the open environment. The place is
 * that environment's "reads secrets from" setting in its repository (owner, 20 Nov); a place outside
 * the name list is read only, another manager's screen comes later. Write mode (owner, 20 Nov, brief MFanevSoVvWE25WMCJsPLn): a new value typed in a
 * row waits as a draft; the counter shows how many; one Save sends them all after one PIN, and
 * staging and production also need the environment's name typed.
 */
@Component({
	selector: 'rc-secrets-screen',
	imports: [Loading, Icon, PinBoxes, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { '(window:beforeunload)': 'unsaved($event)' },
	template: `
		@if (place(); as p) {
			<div class="rc-row between">
				<span class="rc-label">
					<rc-icon [name]="tierIcon()" />
					Infisical · {{ placeLabel() }}
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
						in {{ placeLabel() }}. Nothing is saved yet.
					</div>
					<button
						type="button"
						class="rc-btn ghost"
						(click)="discardAll()"
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
							@if (problems() && v.tier) {
								<b>
									{{ problems() }} name{{ problems() === 1 ? '' : 's' }} need a value in
									{{ v.project }}.
								</b>
								Type each new value in its row and Save; a missing value stops this environment’s
								release.
							} @else if (problems()) {
								<b>
									{{ problems() }} name{{ problems() === 1 ? ' is' : 's are' }} empty in
									{{ v.project }}.
								</b>
								This place is read only here, so add their values in Infisical.
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
									@let draft = draftOf(f.folder, r.name);
									@let open = isOpen(f.folder, r.name);
									<tr [class.sel]="!!draft">
										<td>
											<span class="rc-mono">{{ r.name }}</span>
											@if (!r.expected && v.tier) {
												<span class="rc-pill muted">not in the name list</span>
											}
											@if (r.devOnly) {
												<span class="rc-pill cy">dev only</span>
											}
										</td>
										<td>
											@if (open) {
												<div class="rc-row">
													<div class="rc-msearch">
														<input
															type="password"
															autocomplete="new-password"
															spellcheck="false"
															[attr.aria-label]="'New value for ' + r.name"
															[value]="draft"
															(input)="type(f.folder, r.name, $any($event.target).value)"
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
											@if (open) {
												<button
													type="button"
													class="rc-btn ghost"
													(click)="undo(f.folder, r.name)"
												>
													<rc-icon name="tabler/arrow-back-up" />
													Undo
												</button>
											} @else if (r.writable && v.tier) {
												<button
													type="button"
													class="rc-btn ghost"
													(click)="edit(f.folder, r.name)"
												>
													<rc-icon name="tabler/pencil" />
													New value
												</button>
											} @else {
												<span class="rc-note">{{ v.tier ? 'not editable' : 'read only' }}</span>
											}
										</td>
									</tr>
								}
							}
						</tbody>
					</table>
				</div>
				@if (v.tier) {
					<p class="rc-note">
						Read {{ readAt(v.at) }} with your login, kept for a minute. Switch the environment at the top to
						see another environment’s place. The expected names come from
						<code>docker/infisical/variable-names.json</code>
						.
					</p>
				} @else {
					<p class="rc-note">
						Read {{ readAt(v.at) }} with your login, kept for a minute. Read only: {{ v.project }} ·
						{{ v.environment }} is not in this repository’s name list, so no name is expected or marked
						missing, and new values are added in Infisical itself.
					</p>
				}
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
				<rc-loading [what]="'Reading ' + placeLabel() + ' with your login; this takes a few seconds…'" />
			}

			@if (saving()) {
				<div class="rc-modal-back">
					<form
						class="rc-modal"
						(submit)="save($event)"
					>
						<h3 class="rc-h">
							Save {{ waiting().length }} change{{ waiting().length === 1 ? '' : 's' }} in
							{{ placeLabel() }}
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
						@if (onServer()) {
							<p class="rc-p">
								Type
								<button
									type="button"
									class="rc-chip"
									[attr.data-tip]="copied() ? 'Copied' : 'Click to copy'"
									(click)="copy(envName())"
								>
									{{ envName() }}
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
								[disabled]="!ready()"
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
		} @else if (later(); as l) {
			<div class="rc-banner cy small">
				<span class="rc-dot cy"></span>
				<div>
					<b>
						{{ envLabel() }} reads
						<rc-vendor-logo [vendor]="l.vendor" />
					</b>
					Its Secrets screen comes later; today this screen reads Infisical Cloud.
					@if (l.place) {
						Its place there:
						<code>{{ l.place }}</code>
					}
				</div>
				<button
					type="button"
					class="rc-btn"
					(click)="openSettings()"
				>
					Repository settings ›
				</button>
			</div>
		} @else {
			<div class="rc-banner amber small">
				<span class="rc-dot amber"></span>
				<div>
					@if (unplaced(); as u) {
						<b>
							{{ envLabel() }} reads
							<rc-vendor-logo vendor="infisical" />
							but does not say where.
						</b>
						@if (u.text) {
							“{{ u.text }}” is not a place.
						}
						Type the place as project/environment for the whole environment, or project/environment/folder
						for one folder. For example:
						<code>client-shop-dev/dev</code>
					} @else {
						<b>{{ envLabel() }} reads no secrets manager.</b>
						Its apps read env files written by hand, outside the console, so there is nothing to read here.
						Choose where it reads its secrets to see its names.
					}
				</div>
				<button
					type="button"
					class="rc-btn"
					(click)="openSettings()"
				>
					Repository settings ›
				</button>
			</div>
			@if (fillsThis()) {
				<div class="rc-banner cy">
					<span class="rc-dot cy"></span>
					<div>
						<b>
							This repository’s name list knows where its environments read their secrets in
							<rc-vendor-logo vendor="infisical" />
						</b>
						@for (f of fill(); track f.name) {
							<div>
								{{ f.label }} →
								<code>{{ f.place }}</code>
							</div>
						}
						@if (fillError()) {
							<div class="red">{{ fillError() }}</div>
						}
					</div>
					<button
						type="button"
						class="rc-btn primary"
						[disabled]="filling()"
						(click)="useFill()"
					>
						{{ filling() ? 'Saving…' : 'Use these' }}
					</button>
				</div>
			}
		}
	`,
})
export class SecretsScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly state = inject(ConsoleState);
	private readonly router = inject(Router);
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
	protected readonly filling = signal(false);
	protected readonly fillError = signal('');
	protected readonly results = signal<SaveSecretsResult['results']>([]);

	/** The open environment, from the environment tabs at the top. */
	protected readonly envName = computed(() => this.state.environment());
	private readonly env = computed(() => this.ctx.repo()?.environments.find((e) => e.name === this.envName()) ?? null);
	protected readonly envLabel = computed(() => this.env()?.label ?? this.envName());
	/** Runs on a server (one of the repository's clouds) rather than this computer. */
	protected readonly onServer = computed(() => (this.env()?.cloudId ?? null) !== null);
	/** What the open environment's own setting says it reads. */
	private readonly source = computed(() => {
		const repo = this.ctx.repo();
		return repo ? secretsSourceOf(repo, this.envName()) : ({ kind: 'none' } as const);
	});
	protected readonly place = computed(() => {
		const s = this.source();
		return s.kind === 'infisical' ? s.place : null;
	});
	protected readonly later = computed(() => {
		const s = this.source();
		return s.kind === 'later' ? s : null;
	});
	protected readonly unplaced = computed(() => {
		const s = this.source();
		return s.kind === 'no-place' ? s : null;
	});

	protected readonly view = injectQuery(() => ({
		queryKey: ['secrets', this.ctx.projectId(), this.ctx.repoId(), this.envName(), this.placeText()],
		queryFn: () =>
			this.api.secrets(
				{
					projectId: this.ctx.projectId() ?? '',
					repositoryId: this.ctx.repoId() ?? '',
					environment: this.envName(),
				},
				this.fresher(),
			),
		enabled: this.place() !== null,
		staleTime: 60_000,
	}));
	private readonly placeText = computed(() => {
		const p = this.place();
		return p ? formatSecretsPlace(p) : '';
	});
	/** The place as read: project/environment, and the folder when it is not the whole environment. */
	protected readonly placeLabel = computed(() => {
		const v = this.view.data();
		const p = this.place();
		if (!p) return '';
		const folder = v?.folder ?? p.folder;
		return [v?.project ?? p.project, v?.environment ?? p.environment, ...(folder === '/' ? [] : [folder])].join(
			' · ',
		);
	});
	/** The name-list tier the place matches; `null` when it is read only. Drafts belong to a tier. */
	private readonly tier = computed<SecretTier | null>(() => this.view.data()?.tier ?? null);

	protected readonly shown = computed(() => {
		const folders = this.view.data()?.folders ?? [];
		if (this.tab() !== 'problem') return folders;
		return folders.map((f) => ({ ...f, rows: f.rows.filter(needsOwner) })).filter((f) => f.rows.length);
	});
	protected readonly problems = computed(() =>
		(this.view.data()?.folders ?? []).reduce((n, f) => n + f.rows.filter(needsOwner).length, 0),
	);
	protected readonly tierIcon = computed(() => environmentIcon(this.envName(), !this.onServer()));
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

	/** The name list's places, asked for only while the open environment names none. */
	private readonly places = injectQuery(() => ({
		queryKey: ['secrets-places'],
		queryFn: () => this.api.secretsPlaces(),
		enabled: this.source().kind === 'none' || this.source().kind === 'no-place',
		staleTime: 600_000,
	}));
	/**
	 * The environments of this repository that name no place yet and whose place the name list knows,
	 * offered only when the name list belongs to this repository (the Mac helper's own checkout).
	 */
	protected readonly fill = computed(() => {
		const repo = this.ctx.repo();
		const known = this.places.data();
		if (!repo || !known?.repository) return [];
		if (known.repository.toLowerCase() !== repo.sourceCode.repository.toLowerCase()) return [];
		return repo.environments.flatMap((e) => {
			const kind = secretsSourceOf(repo, e.name).kind;
			if (kind !== 'none' && kind !== 'no-place') return [];
			const tier = tierOf(e.name, e.cloudId === null);
			const p = known.places.find((x) => x.tier === tier);
			return p ? [{ name: e.name, label: e.label, place: `${p.project} · ${p.environment}` }] : [];
		});
	});
	protected readonly fillsThis = computed(() => this.fill().some((f) => f.name === this.envName()));

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
	private draftKey(folder: string, name: string) {
		const tier = this.tier();
		return tier ? { tier, folder, name } : null;
	}
	protected draftOf(folder: string, name: string): string {
		const d = this.draftKey(folder, name);
		return d ? this.drafts.value(d) : '';
	}
	protected isOpen(folder: string, name: string): boolean {
		const d = this.draftKey(folder, name);
		return d ? this.drafts.isOpen(d) : false;
	}
	protected edit(folder: string, name: string): void {
		const d = this.draftKey(folder, name);
		if (d) this.drafts.edit(d);
	}
	protected undo(folder: string, name: string): void {
		const d = this.draftKey(folder, name);
		if (d) this.drafts.undo(d);
	}
	protected type(folder: string, name: string, value: string): void {
		const d = this.draftKey(folder, name);
		if (d) this.drafts.set({ ...d, value });
	}
	protected discardAll(): void {
		const t = this.tier();
		if (t) this.drafts.drop(t);
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
	protected openSettings(): void {
		void this.router.navigate(['/p', this.ctx.projectId(), 'settings'], {
			queryParams: { tab: 'repositories', repo: this.ctx.repoId() },
		});
	}

	/**
	 * Fills in every offered environment's place in one go: Infisical Cloud (added to the repository's
	 * secrets managers if it is not there yet) at the place the name list gives for that environment.
	 */
	protected async useFill(): Promise<void> {
		const repo = this.ctx.repo();
		const projectId = this.ctx.projectId();
		if (!repo || !projectId || this.filling()) return;
		const places = new Map(this.fill().map((f) => [f.name, f.place]));
		const slot = repo.secrets.find((x) => x.vendor === 'infisical') ?? newSlot(repo);
		const next: Repository = {
			...repo,
			secrets: repo.secrets.some((x) => x.id === slot.id) ? repo.secrets : [...repo.secrets, slot],
			environments: repo.environments.map((e) => {
				const place = places.get(e.name);
				return place ? { ...e, secretsId: slot.id, secretsPath: place } : e;
			}),
		};
		this.filling.set(true);
		this.fillError.set('');
		try {
			await this.api.updateRepository(projectId, next);
			await this.ctx.projects.refetch();
		} catch (err) {
			this.fillError.set((err as Error).message);
		} finally {
			this.filling.set(false);
		}
	}

	/** Copies the environment's name, so typing it is a paste; the hint says Copied for a moment. */
	protected copy(text: string): void {
		const done = () => {
			this.copied.set(true);
			setTimeout(() => this.copied.set(false), 1500);
		};
		// Some browser views refuse the clipboard API; a selected text box and the copy command still work there.
		const fallback = () => {
			const box = document.createElement('textarea');
			box.value = text;
			box.setAttribute('readonly', '');
			box.style.position = 'fixed';
			box.style.opacity = '0';
			document.body.append(box);
			box.select();
			const ok = document.execCommand('copy');
			box.remove();
			if (ok) done();
		};
		if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, fallback);
		else fallback();
	}
	protected ready(): boolean {
		const named = !this.onServer() || this.confirmName().trim().toLowerCase() === this.envName().toLowerCase();
		return named && this.pin().length === PIN_LENGTH && !this.busy() && this.waiting().length > 0;
	}

	protected async save(e: Event): Promise<void> {
		e.preventDefault();
		const tier = this.tier();
		if (!this.ready() || !tier) return;
		this.busy.set(true);
		this.message.set('');
		try {
			const answer = await this.api.saveSecrets({
				projectId: this.ctx.projectId() ?? '',
				repositoryId: this.ctx.repoId() ?? '',
				environment: this.envName(),
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

/** A new Infisical Cloud slot for a repository, with an id no other slot uses. */
function newSlot(repo: Repository): SecretsSlot {
	const taken = new Set(repo.secrets.map((x) => x.id));
	let id = 'infisical';
	for (let n = 2; taken.has(id); n += 1) id = `infisical-${n}`;
	return { id, vendor: 'infisical', address: '', keyIds: [] };
}

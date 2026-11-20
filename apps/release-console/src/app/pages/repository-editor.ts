import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
	type CloudVendor,
	type EdgeVendor,
	type Project,
	type SecretsVendor,
	type Repository,
	type SourceCodeVendor,
	VENDOR_NAMES,
	repositorySchema,
	vendorScreens,
} from '@saha-textile/release-console-contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';

import {
	CLOUDS,
	EDGES,
	OWN_MENUS,
	SECRETS,
	SECRETS_NOTES,
	SOURCE,
	SOURCE_NOTES,
	needsAddress,
	slugOf,
} from './add-project';
import { ConsoleApi } from '../data/console-api';
import { CONSOLE_MENU } from '../menu/console-menu.data';

const list = (text: string): string[] =>
	text
		.split(/[\s,]+/)
		.map((t) => t.trim())
		.filter(Boolean);

/** Adds a cloud platform, or removes it and moves its environments back to this computer. */
export function toggleCloudSlot(repo: Repository, vendor: CloudVendor): Repository {
	if (!repo.cloud.some((c) => c.vendor === vendor))
		return { ...repo, cloud: [...repo.cloud, { id: vendor, vendor, account: '', keyIds: [] }] };
	const gone = repo.cloud.filter((c) => c.vendor === vendor).map((c) => c.id);
	return {
		...repo,
		cloud: repo.cloud.filter((c) => c.vendor !== vendor),
		environments: repo.environments.map((e) =>
			e.cloudId && gone.includes(e.cloudId) ? { ...e, cloudId: null } : e,
		),
	};
}

/** Adds an edge platform with no domains, or removes it. */
export function toggleEdgeSlot(repo: Repository, vendor: EdgeVendor): Repository {
	return {
		...repo,
		edge: repo.edge.some((e) => e.vendor === vendor)
			? repo.edge.filter((e) => e.vendor !== vendor)
			: [...repo.edge, { id: vendor, vendor, account: '', zones: [], keyIds: [] }],
	};
}

/** Adds a secrets manager, or removes it and moves its environments back to files kept by hand. */
export function toggleSecretsSlot(repo: Repository, vendor: SecretsVendor): Repository {
	if (!repo.secrets.some((x) => x.vendor === vendor))
		return { ...repo, secrets: [...repo.secrets, { id: vendor, vendor, address: '', keyIds: [] }] };
	const gone = repo.secrets.filter((x) => x.vendor === vendor).map((x) => x.id);
	return {
		...repo,
		secrets: repo.secrets.filter((x) => x.vendor !== vendor),
		environments: repo.environments.map((e) =>
			e.secretsId && gone.includes(e.secretsId) ? { ...e, secretsId: null, secretsPath: '' } : e,
		),
	};
}

/** A new repository that starts with the first repository's environments, clouds, edges and secrets managers (keys included). */
export function newRepository(
	first: Repository | undefined,
	vendor: SourceCodeVendor,
	repository: string,
	role: string,
	menus: string[],
): Repository {
	const name = repository.split('/')[1] ?? repository;
	return {
		id: slugOf(name),
		name,
		role,
		sourceCode: { vendor, repository, keyId: null },
		environments: structuredClone(
			first?.environments ?? [
				{ name: 'local', label: 'Local', cloudId: null, domains: [], secretsId: null, secretsPath: '' },
			],
		),
		cloud: structuredClone(first?.cloud ?? []),
		edge: structuredClone(first?.edge ?? []),
		secrets: structuredClone(first?.secrets ?? []),
		menus,
	};
}

/**
 * Project settings › Repositories: add a repository, change one's environments, clouds, edges and
 * own menus, or remove it. Slots that stay keep their keys; new slots start without keys.
 */
@Component({
	selector: 'rc-repository-editor',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let p = project();
		<div class="rc-panel">
			<div class="rc-ph"><span class="rc-label">Repositories · one source-code vendor each</span></div>
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Repository</th>
							<th>Source code</th>
							<th>Environments</th>
							<th>Clouds</th>
							<th>Edges</th>
							<th>Secrets</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						@for (r of p.repositories; track r.id) {
							<tr>
								<td>
									<b>{{ r.name }}</b>
									<br />
									<span class="rc-mono">{{ r.role }}</span>
								</td>
								<td>
									{{ names[r.sourceCode.vendor] }} ·
									<span class="rc-mono">{{ r.sourceCode.repository }}</span>
								</td>
								<td>{{ envLabels(r) }}</td>
								<td>{{ cloudsOf(r) }}</td>
								<td>{{ edgesOf(r) }}</td>
								<td>{{ secretsOf(r) }}</td>
								<td>
									<button
										type="button"
										class="rc-btn"
										[class.on]="r.id === draft()?.id"
										(click)="edit(r.id)"
									>
										Edit
									</button>
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</div>

		@if (draft(); as d) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">
						{{ d.name }} · {{ names[d.sourceCode.vendor] }} · {{ d.sourceCode.repository }}
					</span>
				</div>
				<div class="rc-form">
					<label>
						Role
						<div class="rc-msearch">
							<input
								type="text"
								autocomplete="off"
								[value]="d.role"
								(input)="patch({ role: $any($event.target).value })"
							/>
						</div>
					</label>
				</div>
				<span class="rc-subl">Environments and where each runs</span>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								<th>Environment</th>
								<th>Runs on</th>
								<th>Domains</th>
								<th>Secrets from</th>
								<th>Where inside it</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							@for (e of d.environments; track e.name; let i = $index) {
								<tr>
									<td>
										<b>{{ e.label }}</b>
										<span class="rc-mono">{{ e.name }}</span>
									</td>
									<td>
										<div class="rc-states">
											<button
												type="button"
												class="rc-chip"
												[class.on]="e.cloudId === null"
												(click)="setEnv(i, { cloudId: null })"
											>
												this computer
											</button>
											@for (c of d.cloud; track c.id) {
												<button
													type="button"
													class="rc-chip"
													[class.on]="e.cloudId === c.id"
													(click)="setEnv(i, { cloudId: c.id })"
												>
													{{ names[c.vendor] }}
												</button>
											}
										</div>
									</td>
									<td>
										<div class="rc-msearch">
											<input
												type="text"
												autocomplete="off"
												[value]="e.domains.join(', ')"
												(change)="setEnv(i, { domains: split($any($event.target).value) })"
											/>
										</div>
									</td>
									<td>
										<div class="rc-states">
											<button
												type="button"
												class="rc-chip"
												[class.on]="e.secretsId === null"
												(click)="setEnv(i, { secretsId: null, secretsPath: '' })"
											>
												files kept by hand
											</button>
											@for (x of d.secrets; track x.id) {
												<button
													type="button"
													class="rc-chip"
													[class.on]="e.secretsId === x.id"
													(click)="setEnv(i, { secretsId: x.id })"
												>
													{{ names[x.vendor] }}
												</button>
											}
										</div>
									</td>
									<td>
										<div class="rc-msearch">
											<input
												type="text"
												autocomplete="off"
												placeholder="project · environment · /folder"
												[value]="e.secretsPath"
												[disabled]="e.secretsId === null"
												(change)="setEnv(i, { secretsPath: $any($event.target).value.trim() })"
											/>
										</div>
									</td>
									<td>
										<button
											type="button"
											class="rc-btn ghost"
											(click)="dropEnv(i)"
										>
											Remove
										</button>
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
				<div class="rc-form">
					<label>
						Add
						<div class="rc-msearch">
							<input
								#envName
								type="text"
								autocomplete="off"
								placeholder="preview, qa, demo…"
							/>
						</div>
					</label>
				</div>
				<div>
					<button
						type="button"
						class="rc-btn"
						(click)="addEnv(envName)"
					>
						+ Add environment
					</button>
				</div>

				<div class="rc-g2">
					<div class="pj-vendors">
						<span class="rc-subl">Cloud platforms · one or more</span>
						@for (c of clouds; track c) {
							<div
								class="pj-vendor"
								role="checkbox"
								tabindex="0"
								[class.on]="hasCloud(c)"
								(click)="toggleCloud(c)"
								(keydown.enter)="toggleCloud(c)"
							>
								<b>{{ names[c] }}</b>
								<small>{{ screens(c) === 'full' ? 'full console screens' : 'screens later' }}</small>
								<span
									class="rc-pill"
									[class.ok]="hasCloud(c)"
									[class.amber]="!hasCloud(c) && screens(c) === 'later'"
									[class.muted]="!hasCloud(c) && screens(c) === 'full'"
								>
									{{ hasCloud(c) ? 'active' : screens(c) === 'later' ? 'screens later' : 'choose' }}
								</span>
							</div>
						}
					</div>
					<div class="pj-vendors">
						<span class="rc-subl">Edge, DNS and security · each domain on one</span>
						@for (v of edges; track v) {
							<div
								class="pj-vendor"
								role="checkbox"
								tabindex="0"
								[class.on]="hasEdge(v)"
								(click)="toggleEdge(v)"
								(keydown.enter)="toggleEdge(v)"
							>
								<b>{{ names[v] }}</b>
								<small>{{ screens(v) === 'full' ? 'full console screens' : 'screens later' }}</small>
								<span
									class="rc-pill"
									[class.ok]="hasEdge(v)"
									[class.amber]="!hasEdge(v) && screens(v) === 'later'"
									[class.muted]="!hasEdge(v) && screens(v) === 'full'"
								>
									{{ hasEdge(v) ? 'active' : screens(v) === 'later' ? 'screens later' : 'choose' }}
								</span>
							</div>
						}
						<div class="rc-form">
							@for (e of d.edge; track e.id; let i = $index) {
								<label>
									{{ names[e.vendor] }}
									<div class="rc-msearch">
										<input
											type="text"
											autocomplete="off"
											placeholder="example.com"
											[value]="e.zones.join(', ')"
											(change)="setZones(i, $any($event.target).value)"
										/>
									</div>
								</label>
							}
						</div>
					</div>
				</div>

				<div class="pj-vendors">
					<span class="rc-subl">Secrets managers · one or more; each environment reads one</span>
					<div class="pj-grid">
						@for (v of secretsVendors; track v) {
							<div
								class="pj-vendor"
								role="checkbox"
								tabindex="0"
								[class.on]="hasSecrets(v)"
								[attr.aria-checked]="hasSecrets(v)"
								(click)="toggleSecrets(v)"
								(keydown.enter)="toggleSecrets(v)"
							>
								<b>{{ names[v] }}</b>
								<small>{{ secretsNotes[v] }}</small>
								<span
									class="rc-pill"
									[class.ok]="hasSecrets(v)"
									[class.amber]="!hasSecrets(v) && screens(v) === 'later'"
									[class.muted]="!hasSecrets(v) && screens(v) === 'full'"
								>
									{{ hasSecrets(v) ? 'active' : screens(v) === 'later' ? 'screens later' : 'choose' }}
								</span>
							</div>
						}
					</div>
					<div class="rc-form">
						@for (x of d.secrets; track x.id; let i = $index) {
							@if (addressNeeded(x.vendor)) {
								<label>
									{{ names[x.vendor] }}
									<div class="rc-msearch">
										<input
											type="url"
											autocomplete="off"
											placeholder="https://secrets.example.com"
											[value]="x.address"
											(change)="setSecretsAddress(i, $any($event.target).value)"
										/>
									</div>
								</label>
							}
						}
					</div>
				</div>

				<span class="rc-subl">Own menus · first group of this repository's menu</span>
				<div class="pj-grid">
					@for (m of ownMenus; track m) {
						<div
							class="do-radio"
							role="checkbox"
							tabindex="0"
							[class.on]="d.menus.includes(m)"
							(click)="toggleMenu(m)"
							(keydown.enter)="toggleMenu(m)"
						>
							<i aria-hidden="true"></i>
							<span>
								<b>{{ menuLabel(m) }}</b>
								<small>{{ menuCaption(m) }}</small>
							</span>
						</div>
					}
				</div>
				<p class="rc-note">
					Slots that stay keep their keys. A newly added cloud, edge platform or secrets manager starts
					without a key; connect it on the Connections tab.
				</p>
				@if (message()) {
					<p class="rc-note">{{ message() }}</p>
				}
				<div class="rc-row between do-nav">
					<button
						type="button"
						class="rc-btn danger"
						[disabled]="busy() || p.repositories.length === 1"
						(click)="remove()"
					>
						Remove repository
					</button>
					<div class="rc-row">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="cancel()"
						>
							Cancel
						</button>
						<button
							type="button"
							class="rc-btn primary"
							[disabled]="busy()"
							(click)="save()"
						>
							Save {{ d.name }}
						</button>
					</div>
				</div>
			</div>
		}

		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">Add a repository · one source-code vendor per repository</span>
			</div>
			<div class="rc-g2">
				<div class="pj-vendors">
					@for (v of source; track v) {
						<div
							class="pj-vendor"
							role="radio"
							tabindex="0"
							[class.on]="newVendor() === v"
							(click)="newVendor.set(v)"
							(keydown.enter)="newVendor.set(v)"
						>
							<b>{{ names[v] }}</b>
							<small>{{ sourceNotes[v] }}</small>
							@if (newVendor() === v) {
								<span class="rc-pill ok">chosen</span>
							} @else if (screens(v) === 'later') {
								<span class="rc-pill amber">screens later</span>
							} @else {
								<span class="rc-pill muted">choose</span>
							}
						</div>
					}
				</div>
				<div class="rc-form">
					<label>
						owner/name
						<div class="rc-msearch">
							<input
								#repoName
								type="text"
								autocomplete="off"
								placeholder="Kaizer-Systems/shop-web"
							/>
						</div>
					</label>
					<label>
						Role
						<div class="rc-msearch">
							<input
								#repoRole
								type="text"
								autocomplete="off"
								placeholder="storefront, API, admin…"
							/>
						</div>
					</label>
					<p class="rc-note">
						The new repository starts with the environments, clouds and edges of
						{{ p.repositories[0]?.name }}, keys included, and its own menus from its .release-console.json
						when GitHub has one.
					</p>
					<div>
						<button
							type="button"
							class="rc-btn"
							[disabled]="busy()"
							(click)="add(repoName, repoRole)"
						>
							+ Add repository
						</button>
					</div>
					@if (message() && !draft()) {
						<p class="rc-note">{{ message() }}</p>
					}
				</div>
			</div>
		</div>
	`,
})
export class RepositoryEditor {
	private readonly api = inject(ConsoleApi);
	private readonly queries = inject(QueryClient);
	private readonly router = inject(Router);
	readonly project = input.required<Project>();
	/** The repository to open for editing, from the `repo` query parameter. */
	readonly open = input<string | undefined>(undefined);
	protected readonly names = VENDOR_NAMES;
	protected readonly source = SOURCE;
	protected readonly sourceNotes = SOURCE_NOTES;
	protected readonly clouds = CLOUDS;
	protected readonly edges = EDGES;
	protected readonly secretsVendors = SECRETS;
	protected readonly secretsNotes = SECRETS_NOTES;
	protected readonly addressNeeded = needsAddress;
	protected readonly ownMenus = OWN_MENUS;
	protected readonly screens = vendorScreens;
	protected readonly split = list;
	protected readonly draft = signal<Repository | null>(null);
	protected readonly newVendor = signal<SourceCodeVendor>('github');
	protected readonly busy = signal(false);
	protected readonly message = signal('');
	private readonly opened = computed(() => this.project().repositories.find((r) => r.id === this.open()) ?? null);

	constructor() {
		effect(() => {
			const r = this.opened();
			if (r && this.draft()?.id !== r.id) this.draft.set(structuredClone(r));
		});
	}

	protected secretsOf(r: Repository): string {
		return r.secrets.map((x) => VENDOR_NAMES[x.vendor]).join(' + ') || 'files kept by hand';
	}
	protected envLabels(r: Repository): string {
		return r.environments.map((e) => e.label).join(' · ');
	}
	protected cloudsOf(r: Repository): string {
		return r.cloud.map((c) => VENDOR_NAMES[c.vendor]).join(' + ') || 'this computer only';
	}
	protected edgesOf(r: Repository): string {
		return (
			r.edge
				.map((e) => `${VENDOR_NAMES[e.vendor]}${e.zones.length ? ` (${e.zones.join(', ')})` : ''}`)
				.join(' + ') || '—'
		);
	}
	protected menuLabel(key: string): string {
		return CONSOLE_MENU.screens[key]?.label ?? key;
	}
	protected menuCaption(key: string): string {
		return Object.values(CONSOLE_MENU.screens[key]?.captions ?? {})[0] ?? '';
	}

	protected edit(id: string): void {
		this.message.set('');
		void this.router.navigate([], { queryParams: { tab: 'repositories', repo: id } });
		const r = this.project().repositories.find((x) => x.id === id);
		if (r) this.draft.set(structuredClone(r));
	}
	protected cancel(): void {
		this.draft.set(null);
		void this.router.navigate([], { queryParams: { tab: 'repositories' } });
	}
	protected patch(change: Partial<Repository>): void {
		this.draft.update((d) => (d ? { ...d, ...change } : d));
	}
	protected setEnv(i: number, change: Partial<Repository['environments'][number]>): void {
		this.draft.update((d) =>
			d ? { ...d, environments: d.environments.map((e, n) => (n === i ? { ...e, ...change } : e)) } : d,
		);
	}
	protected addEnv(box: HTMLInputElement): void {
		const label = box.value.trim();
		const name = slugOf(label);
		const d = this.draft();
		if (!d || !name || d.environments.some((e) => e.name === name)) return;
		this.patch({
			environments: [
				...d.environments,
				{ name, label, cloudId: null, domains: [], secretsId: null, secretsPath: '' },
			],
		});
		box.value = '';
	}
	protected dropEnv(i: number): void {
		const d = this.draft();
		if (d && d.environments.length > 1) this.patch({ environments: d.environments.filter((_, n) => n !== i) });
		else this.message.set('A repository keeps at least one environment.');
	}
	protected hasCloud(v: CloudVendor): boolean {
		return !!this.draft()?.cloud.some((c) => c.vendor === v);
	}
	protected toggleCloud(v: CloudVendor): void {
		this.draft.update((d) => (d ? toggleCloudSlot(d, v) : d));
	}
	protected hasEdge(v: EdgeVendor): boolean {
		return !!this.draft()?.edge.some((e) => e.vendor === v);
	}
	protected toggleEdge(v: EdgeVendor): void {
		this.draft.update((d) => (d ? toggleEdgeSlot(d, v) : d));
	}
	protected hasSecrets(v: SecretsVendor): boolean {
		return !!this.draft()?.secrets.some((x) => x.vendor === v);
	}
	protected toggleSecrets(v: SecretsVendor): void {
		this.draft.update((d) => (d ? toggleSecretsSlot(d, v) : d));
	}
	protected setSecretsAddress(i: number, text: string): void {
		this.draft.update((d) =>
			d ? { ...d, secrets: d.secrets.map((x, n) => (n === i ? { ...x, address: text.trim() } : x)) } : d,
		);
	}
	protected setZones(i: number, text: string): void {
		this.draft.update((d) =>
			d ? { ...d, edge: d.edge.map((e, n) => (n === i ? { ...e, zones: list(text) } : e)) } : d,
		);
	}
	protected toggleMenu(m: string): void {
		const d = this.draft();
		if (d) this.patch({ menus: d.menus.includes(m) ? d.menus.filter((x) => x !== m) : [...d.menus, m] });
	}

	protected async save(): Promise<void> {
		const missing = this.draft()?.secrets.find(
			(x) => needsAddress(x.vendor) && !/^https?:\/\/\S+$/.test(x.address),
		);
		if (missing) {
			this.message.set(`Give ${VENDOR_NAMES[missing.vendor]} its server's address, starting with https://.`);
			return;
		}
		const parsed = repositorySchema.safeParse(this.draft());
		if (!parsed.success) {
			this.message.set(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
			return;
		}
		await this.run(async () => {
			await this.api.updateRepository(this.project().id, parsed.data);
			this.message.set(`${parsed.data.name} saved.`);
		});
	}

	protected async remove(): Promise<void> {
		const d = this.draft();
		if (!d || !window.confirm(`Remove ${d.name} from ${this.project().name}? The project's keys stay.`)) return;
		await this.run(async () => {
			await this.api.removeRepository(this.project().id, d.id);
			this.cancel();
		});
	}

	protected async add(box: HTMLInputElement, role: HTMLInputElement): Promise<void> {
		const repository = box.value.trim();
		if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
			this.message.set('Write the repository as owner/name.');
			return;
		}
		const p = this.project();
		const first = p.repositories[0];
		const vendor = this.newVendor();
		let menus: string[] = [];
		if (vendor === 'github') {
			const file = await this.api.repositoryFile({ vendor, repository }).catch(() => null);
			if (file?.state === 'ok') menus = file.data.menus.filter((m) => !!CONSOLE_MENU.screens[m]);
		}
		const repo = newRepository(first, vendor, repository, role.value.trim(), menus);
		await this.run(async () => {
			await this.api.addRepository(p.id, repo);
			box.value = '';
			role.value = '';
			this.message.set(
				`${repo.name} added${menus.length ? ` with its own menus from .release-console.json` : ''}. Connect its source code on the Connections tab.`,
			);
		});
	}

	private async run(work: () => Promise<void>): Promise<void> {
		this.busy.set(true);
		try {
			await work();
			await this.queries.invalidateQueries({ queryKey: ['projects'] });
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}
}

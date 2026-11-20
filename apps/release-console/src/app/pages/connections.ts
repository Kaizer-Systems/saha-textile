import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import {
	KEY_KINDS,
	type KeyKind,
	type KeyRef,
	type Project,
	type SlotKeys,
	type Vendor,
	SECRETS_HOSTING,
	VENDOR_NAMES,
	CONSOLE_KEYS_FOLDER,
	envNameSchema,
	vendorScreens,
} from '@saha-textile/release-console-contracts';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';

import { day, when } from './format-time';
import { ConsoleApi } from '../data/console-api';
import { Icon } from '../shared/icons';
import { VendorLogo } from '../shared/vendor-logo';

/** Kinds the owner can link here, each by its Infisical name; the GitHub CLI sign-in needs none. */
const LINK_KINDS: KeyKind[] = [
	'do-read',
	'do-change',
	'spaces-key',
	'cf-read',
	'cf-change',
	'github-token',
	'github-cli',
	'service-key',
];

interface SlotChoice {
	id: string;
	label: string;
	vendor: Vendor;
	slot: SlotKeys;
}

/** A key's state as the brief's pill: colour and words. */
export function keyPill(ref: KeyRef | undefined): { cls: string; text: string } {
	if (!ref) return { cls: 'muted', text: 'not connected' };
	switch (ref.state) {
		case 'verified':
			return { cls: 'ok', text: 'connected' };
		case 'expiring':
			return { cls: 'amber', text: `expires ${day(ref.expiresAt)}` };
		case 'expired':
			return { cls: 'red', text: 'expired' };
		case 'failed':
			return { cls: 'red', text: 'check failed' };
		default:
			return { cls: 'cy', text: 'unchecked' };
	}
}

/**
 * Project settings › Connections: every key by category and repository. Keys live in Infisical; the
 * console links each to its Infisical name and never sees a pasted value. One key serves every repository of
 * this project that uses the same account, and never another project.
 */
@Component({
	selector: 'rc-connections',
	imports: [Icon, VendorLogo],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let p = project();
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/brand-git" />
					Source code · one vendor per repository
				</span>
			</div>
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Repository</th>
							<th>Vendor · repository</th>
							<th>Key</th>
							<th>State</th>
						</tr>
					</thead>
					<tbody>
						@for (r of p.repositories; track r.id) {
							@let ref = keyById(r.sourceCode.keyId);
							@let pill = pillOf(ref);
							<tr>
								<td>
									<b>{{ r.name }}</b>
								</td>
								<td>
									<rc-vendor-logo
										[vendor]="r.sourceCode.vendor"
										[size]="14"
									/>
									·
									<span class="rc-mono">{{ r.sourceCode.repository }}</span>
									{{ ref?.account ? ' · ' + ref?.account : '' }}
								</td>
								<td>{{ ref?.label ?? '—' }}</td>
								<td>
									<span
										class="rc-pill"
										[class]="pill.cls"
									>
										{{ r.sourceCode.vendor === 'github' ? pill.text : 'screens later' }}
									</span>
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</div>
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/cloud" />
					Cloud platforms · per repository
				</span>
			</div>
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Repository</th>
							<th>Platform</th>
							<th>Keys</th>
							<th>State</th>
						</tr>
					</thead>
					<tbody>
						@for (row of cloudRows(); track row.id) {
							<tr>
								<td>
									<b>{{ row.repo }}</b>
								</td>
								<td>
									<rc-vendor-logo
										[vendor]="row.vendor"
										[size]="14"
									/>
								</td>
								<td>{{ row.keys }}</td>
								<td>
									<span
										class="rc-pill"
										[class]="row.pill.cls"
									>
										{{ row.pill.text }}
									</span>
								</td>
							</tr>
						} @empty {
							<tr><td colspan="4">No repository of this project uses a cloud platform.</td></tr>
						}
					</tbody>
				</table>
			</div>
		</div>
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/world" />
					Edge, DNS and security
				</span>
			</div>
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Repository</th>
							<th>Platform</th>
							<th>Domains</th>
							<th>Keys</th>
							<th>State</th>
						</tr>
					</thead>
					<tbody>
						@for (row of edgeRows(); track row.id) {
							<tr>
								<td>
									<b>{{ row.repo }}</b>
								</td>
								<td>
									<rc-vendor-logo
										[vendor]="row.vendor"
										[size]="14"
									/>
								</td>
								<td class="rc-mono">{{ row.zones }}</td>
								<td>{{ row.keys }}</td>
								<td>
									<span
										class="rc-pill"
										[class]="row.pill.cls"
									>
										{{ row.pill.text }}
									</span>
								</td>
							</tr>
						} @empty {
							<tr><td colspan="5">No repository of this project uses an edge platform.</td></tr>
						}
					</tbody>
				</table>
			</div>
		</div>
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/key" />
					Secrets managers · per repository
				</span>
			</div>
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Repository</th>
							<th>Manager</th>
							<th>Runs</th>
							<th>Environments reading it</th>
							<th>State</th>
						</tr>
					</thead>
					<tbody>
						@for (row of secretsRows(); track row.id) {
							<tr>
								<td>
									<b>{{ row.repo }}</b>
								</td>
								<td>
									<rc-vendor-logo
										[vendor]="row.vendor"
										[size]="14"
									/>
								</td>
								<td class="rc-mono">{{ row.runs }}</td>
								<td>{{ row.envs }}</td>
								<td>
									@if (screens(row.vendor) === 'full') {
										<!-- Infisical Cloud is read on Run › Secrets with the owner's own Infisical login: no key here. -->
										<span class="rc-pill cy">Run › Secrets · your login</span>
									} @else {
										<span class="rc-pill amber">screens later</span>
									}
								</td>
							</tr>
						} @empty {
							<tr>
								<td colspan="5">
									No repository of this project names a secrets manager; its environments read no
									manager.
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</div>
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/file-certificate" />
					Key file · from Infisical, written with your login
				</span>
			</div>
			@if (source.data(); as f) {
				<div class="rc-kv">
					<div>
						<span>Infisical folder</span>
						<em class="rc-mono">{{ f.folder }}</em>
					</div>
					<div>
						<span>Key file</span>
						<em class="rc-mono">{{ f.present ? f.file : 'not written yet' }}</em>
					</div>
					<div>
						<span>Written</span>
						<em class="rc-mono">{{ when(f.readAt) }}</em>
					</div>
					<div>
						<span>Names with a value</span>
						<em class="rc-mono">{{ f.names.join(', ') || 'none' }}</em>
					</div>
					<div>
						<span>Not in Infisical yet</span>
						<em
							class="rc-mono"
							[class.amber]="f.missing.length > 0"
						>
							{{ f.missing.join(', ') || 'none' }}
						</em>
					</div>
					<div>
						<span>Optional, blank</span>
						<em class="rc-mono">{{ f.optionalBlank.join(', ') || 'none' }}</em>
					</div>
				</div>
				<p class="rc-note">
					Add or change a key in Infisical, then run
					<code>pnpm console:env</code>
					on this Mac; the console reads the new file at once. Names only are shown here, never values.
				</p>
			} @else if (source.isError()) {
				<p class="rc-p red">The console API is not answering.</p>
			}
		</div>
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/key" />
					Keys in {{ p.name }} · values only in Infisical
				</span>
			</div>
			<div class="rc-tw">
				<table class="rc-t">
					<thead>
						<tr>
							<th>Key</th>
							<th>Account</th>
							<th>Rights</th>
							<th>Expires</th>
							<th>Checked</th>
							<th>State</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						@for (k of p.keys; track k.id) {
							@let pill = pillOf(k);
							<tr>
								<td>
									<b>
										@if (kinds[k.kind].vendor; as kv) {
											<rc-vendor-logo
												[vendor]="kv"
												[named]="false"
												[size]="14"
											/>
										} @else {
											<rc-icon name="tabler/key" />
										}
										{{ k.label }}
									</b>
									<br />
									<span class="rc-mono">
										{{ k.envNames.length ? k.envNames.join(' + ') : 'kept by the GitHub CLI' }}
									</span>
								</td>
								<td>{{ k.account || '—' }}</td>
								<td class="rc-mono">{{ k.rights.join(', ') || '—' }}</td>
								<td class="rc-mono">{{ day(k.expiresAt) }}</td>
								<td class="rc-mono">{{ when(k.checkedAt) }}</td>
								<td>
									<span
										class="rc-pill"
										[class]="pill.cls"
									>
										{{ pill.text }}
									</span>
									@if (k.note) {
										<br />
										<span class="rc-note">{{ k.note }}</span>
									}
								</td>
								<td>
									<div class="rc-row">
										<button
											type="button"
											class="rc-btn ghost"
											[disabled]="busy()"
											(click)="check(k.id)"
										>
											Check
										</button>
										<button
											type="button"
											class="rc-btn danger"
											[disabled]="busy()"
											(click)="remove(k)"
										>
											Unlink
										</button>
									</div>
								</td>
							</tr>
						} @empty {
							<tr><td colspan="7">No keys yet.</td></tr>
						}
					</tbody>
				</table>
			</div>
			@if (message()) {
				<p class="rc-note">{{ message() }}</p>
			}
		</div>
		<form
			class="rc-panel"
			(submit)="save($event)"
		>
			<div class="rc-ph">
				<span class="rc-label">
					<rc-icon name="tabler/link" />
					Link a key · by its Infisical name, never a pasted value
				</span>
			</div>
			<div class="rc-g2">
				<div class="pj-vendors">
					@for (k of linkKinds; track k) {
						<div
							class="do-radio"
							role="radio"
							tabindex="0"
							[class.on]="kind() === k"
							[attr.aria-checked]="kind() === k"
							(click)="choose(k)"
							(keydown.enter)="choose(k)"
						>
							<i aria-hidden="true"></i>
							<span>
								<b>
									@if (kinds[k].vendor; as kv) {
										<rc-vendor-logo
											[vendor]="kv"
											[named]="false"
											[size]="14"
										/>
									} @else {
										<rc-icon name="tabler/key" />
									}
									{{ kinds[k].label }}
								</b>
								<small>{{ kinds[k].howTo }}</small>
							</span>
						</div>
					}
				</div>
				<div class="rc-form">
					@if (kinds[kind()].stored) {
						@for (n of kinds[kind()].envNames; track n; let i = $index) {
							<label>
								{{
									kind() === 'spaces-key'
										? i === 0
											? 'Access key name'
											: 'Secret name'
										: 'Infisical name'
								}}
								<div class="rc-msearch">
									<input
										type="text"
										autocomplete="off"
										spellcheck="false"
										[attr.name]="'env' + i"
										[value]="n"
										[attr.aria-label]="'Infisical name ' + (i + 1)"
									/>
								</div>
							</label>
						}
						@if (!kinds[kind()].envNames.length) {
							<label>
								Infisical name
								<div class="rc-msearch">
									<input
										type="text"
										autocomplete="off"
										spellcheck="false"
										name="env0"
										placeholder="CONSOLE_SERVICE_KEY"
										aria-label="Infisical name"
									/>
								</div>
							</label>
						}
					} @else {
						<p class="rc-note">
							Nothing is read from Infisical: the console uses the GitHub CLI's own sign-in, which works
							only when the console runs outside Docker, and checks that it opens each chosen repository.
						</p>
					}
					@if (kind() === 'spaces-key') {
						<label>
							Bucket
							<div class="rc-msearch">
								<input
									type="text"
									name="target"
									autocomplete="off"
									placeholder="sgp1/saha-textile-media"
									aria-label="Spaces region and bucket"
								/>
							</div>
						</label>
					}
					@if (kinds[kind()].stored) {
						<label>
							Expires
							<div class="rc-msearch">
								<input
									type="date"
									name="expires"
									aria-label="Expiry date"
								/>
							</div>
						</label>
					}
					<span class="rc-label">
						<rc-icon name="tabler/target" />
						Use it for
					</span>
					@for (c of slotChoices(); track c.id) {
						<div
							class="do-radio"
							role="checkbox"
							tabindex="0"
							[class.on]="picked().has(c.id)"
							[attr.aria-checked]="picked().has(c.id)"
							(click)="toggle(c.id)"
							(keydown.enter)="toggle(c.id)"
						>
							<i aria-hidden="true"></i>
							<span>
								<b>
									<rc-vendor-logo
										[vendor]="c.vendor"
										[named]="false"
										[size]="14"
									/>
									{{ c.label }}
								</b>
								<small>this project only</small>
							</span>
						</div>
					} @empty {
						<p class="rc-note">
							No repository of {{ p.name }} uses {{ vendors[kindVendor()] }}; the key is kept for later.
						</p>
					}
					<p class="rc-note">
						Save the key in Infisical ({{ keysFolder }}) under the name above, run
						<code>pnpm console:env</code>
						, then link it here; it is checked at once. The console never sees or shows the value.
						Cloudflare tokens come from the Cloudflare account that holds the domain.
					</p>
					<div>
						<button
							type="submit"
							class="rc-btn primary"
							[disabled]="busy()"
						>
							Link and check
						</button>
					</div>
					@if (formMessage()) {
						<p class="rc-note">{{ formMessage() }}</p>
					}
				</div>
			</div>
		</form>
	`,
})
export class Connections {
	private readonly api = inject(ConsoleApi);
	private readonly queries = inject(QueryClient);
	readonly project = input.required<Project>();
	protected readonly keysFolder = CONSOLE_KEYS_FOLDER;
	protected readonly screens = vendorScreens;
	protected readonly source = injectQuery(() => ({
		queryKey: ['key-source'],
		queryFn: () => this.api.keySource(),
		refetchInterval: 15_000,
	}));
	protected readonly kinds = KEY_KINDS;
	protected readonly vendors = VENDOR_NAMES;
	protected readonly linkKinds = LINK_KINDS;
	protected readonly day = day;
	protected readonly when = when;
	protected readonly kind = signal<KeyKind>('do-read');
	protected readonly picked = signal<Set<string>>(new Set());
	protected readonly busy = signal(false);
	protected readonly message = signal('');
	protected readonly formMessage = signal('');

	protected readonly kindVendor = computed(() => KEY_KINDS[this.kind()].vendor ?? 'github');
	/** A new key id: the kind, or the kind with a number when the project has one already. */
	protected readonly nextId = computed(() => {
		const ids = new Set(this.project().keys.map((k) => k.id));
		const base = this.kind();
		let id: string = base;
		for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
		return id;
	});

	protected readonly slotChoices = computed<SlotChoice[]>(() => {
		const info = KEY_KINDS[this.kind()];
		const out: SlotChoice[] = [];
		for (const r of this.project().repositories) {
			if (info.slot === 'source-code' && r.sourceCode.vendor === info.vendor)
				out.push({
					id: `${r.id}:sc`,
					label: `${r.name} · ${VENDOR_NAMES[r.sourceCode.vendor]}`,
					vendor: r.sourceCode.vendor,
					slot: { repositoryId: r.id, slot: 'source-code', slotId: '', keyIds: [] },
				});
			if (info.slot === 'cloud')
				for (const c of r.cloud.filter((c) => c.vendor === info.vendor))
					out.push({
						id: `${r.id}:c:${c.id}`,
						label: `${r.name} · ${VENDOR_NAMES[c.vendor]}`,
						vendor: c.vendor,
						slot: { repositoryId: r.id, slot: 'cloud', slotId: c.id, keyIds: c.keyIds },
					});
			if (info.slot === 'edge')
				for (const e of r.edge.filter((e) => e.vendor === info.vendor))
					out.push({
						id: `${r.id}:e:${e.id}`,
						label: `${r.name} · ${VENDOR_NAMES[e.vendor]} (${e.zones.join(', ') || 'no domain'})`,
						vendor: e.vendor,
						slot: { repositoryId: r.id, slot: 'edge', slotId: e.id, keyIds: e.keyIds },
					});
		}
		return out;
	});

	protected readonly cloudRows = computed(() =>
		this.project().repositories.flatMap((r) =>
			r.cloud.map((c) => ({
				id: `${r.id}:${c.id}`,
				repo: r.name,
				vendor: c.vendor,
				keys: this.labels(c.keyIds),
				pill: c.vendor === 'digitalocean' ? this.slotPill(c.keyIds) : { cls: 'amber', text: 'screens later' },
			})),
		),
	);
	protected readonly edgeRows = computed(() =>
		this.project().repositories.flatMap((r) =>
			r.edge.map((e) => ({
				id: `${r.id}:${e.id}`,
				repo: r.name,
				vendor: e.vendor,
				zones: e.zones.join(', ') || '—',
				keys: this.labels(e.keyIds),
				pill: e.vendor === 'cloudflare' ? this.slotPill(e.keyIds) : { cls: 'amber', text: 'screens later' },
			})),
		),
	);

	protected readonly secretsRows = computed(() =>
		this.project().repositories.flatMap((r) =>
			r.secrets.map((x) => ({
				id: `${r.id}:${x.id}`,
				repo: r.name,
				vendor: x.vendor,
				runs:
					x.address ||
					(SECRETS_HOSTING[x.vendor] === 'managed'
						? 'managed service'
						: SECRETS_HOSTING[x.vendor] === 'source-code'
							? 'inside the source-code vendor'
							: 'on the server'),
				envs:
					r.environments
						.filter((e) => e.secretsId === x.id)
						.map((e) => (e.secretsPath ? `${e.label} (${e.secretsPath})` : e.label))
						.join(', ') || 'none yet',
			})),
		),
	);

	constructor() {
		this.choose('do-read');
	}

	protected keyById(id: string | null): KeyRef | undefined {
		return this.project().keys.find((k) => k.id === id);
	}
	protected pillOf(ref: KeyRef | undefined) {
		return keyPill(ref);
	}
	private labels(ids: string[]): string {
		return ids.map((id) => this.keyById(id)?.label ?? id).join(' · ') || '—';
	}
	/** A slot is as good as its best key. */
	private slotPill(ids: string[]): { cls: string; text: string } {
		const refs = ids.map((id) => this.keyById(id)).filter((k): k is KeyRef => !!k);
		const order = ['verified', 'expiring', 'unchecked', 'failed', 'expired'];
		refs.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
		return keyPill(refs[0]);
	}

	protected choose(k: KeyKind): void {
		this.kind.set(k);
		queueMicrotask(() => this.picked.set(new Set(this.slotChoices().map((c) => c.id))));
	}
	protected toggle(id: string): void {
		const next = new Set(this.picked());
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.picked.set(next);
	}

	protected async save(e: Event): Promise<void> {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const field = (name: string) => form.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value.trim() ?? '';
		const kind = this.kind();
		const envNames = [field('env0'), field('env1')].filter(Boolean);
		const target = field('target');
		const expires = field('expires');
		if (KEY_KINDS[kind].stored && !envNames.length) {
			this.formMessage.set('Name the Infisical variable that holds this key.');
			return;
		}
		const badName = envNames.find((n) => !envNameSchema.safeParse(n).success);
		if (badName) {
			this.formMessage.set(`${badName} is not an Infisical name: use capitals, digits and underscores.`);
			return;
		}
		if (kind === 'spaces-key' && !/^[a-z0-9-]+\/[a-z0-9.-]+$/.test(target)) {
			this.formMessage.set('Give the bucket as region/bucket, for example sgp1/saha-textile-media.');
			return;
		}
		const p = this.project();
		const id = this.nextId();
		this.busy.set(true);
		this.formMessage.set('Linking and checking with the vendor…');
		try {
			const ref = await this.api.linkKey(p.id, {
				id,
				kind,
				label: KEY_KINDS[kind].label,
				envNames: KEY_KINDS[kind].stored ? envNames : [],
				expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
				note: '',
				target,
			});
			for (const c of this.slotChoices().filter((c) => this.picked().has(c.id)))
				await this.api.setSlotKeys(p.id, {
					...c.slot,
					keyIds: c.slot.slot === 'source-code' ? [id] : [...new Set([...c.slot.keyIds, id])],
				});
			this.formMessage.set(`${ref.label}: ${keyPill(ref).text}${ref.note ? ` · ${ref.note}` : ''}`);
			await this.refresh();
		} catch (err) {
			this.formMessage.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}

	protected async check(keyId: string): Promise<void> {
		this.busy.set(true);
		try {
			const ref = await this.api.checkKey(this.project().id, keyId);
			this.message.set(`${ref.label}: ${keyPill(ref).text}${ref.note ? ` · ${ref.note}` : ''}`);
			await this.refresh();
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}

	protected async remove(k: KeyRef): Promise<void> {
		if (!window.confirm(`Unlink ${k.label} from ${this.project().name}? The key stays in Infisical.`)) return;
		this.busy.set(true);
		try {
			await this.api.removeKey(this.project().id, k.id);
			this.message.set(`${k.label} unlinked; it stays in Infisical.`);
			await this.refresh();
		} catch (err) {
			this.message.set((err as Error).message);
		} finally {
			this.busy.set(false);
		}
	}

	private async refresh(): Promise<void> {
		await this.queries.invalidateQueries({ queryKey: ['projects'] });
		await this.queries.invalidateQueries({ queryKey: ['attention'] });
		await this.queries.invalidateQueries({ queryKey: ['vendor'] });
		await this.queries.invalidateQueries({ queryKey: ['key-source'] });
	}
}

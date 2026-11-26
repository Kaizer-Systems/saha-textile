import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';

import { SparkLine } from './local-parts';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';
import { when } from '../pages/format-time';
import { PIN_LENGTH, PinBoxes } from '../shared/pin-boxes';

import type {
	ProductAction,
	ProductFieldValue,
	ProductForm,
	ProductJob,
	ProductMonitor,
	ProductRow,
	ProductTable,
	ProductView,
	Tone,
} from '@saha-textile/release-console-contracts';

const dot = (t: Tone) =>
	t === 'ok' ? 'ok' : t === 'red' ? 'red' : t === 'amber' ? 'amber' : t === 'muted' ? '' : 'cy';

/** Tiles, notes, facts, tables, links and buttons: every read tab of a product screen. */
@Component({
	selector: 'rc-product-view',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let v = view();
		@if (v.head || v.actions.length) {
			<div class="rc-row between">
				<div>
					@if (v.head; as h) {
						<span class="rc-label">{{ noun() }}</span>
						<h3 class="rc-h">
							{{ h.name }}
							@if (h.status) {
								<span
									class="rc-pill"
									[class]="'rc-pill ' + pill(h.tone)"
								>
									{{ h.status }}
								</span>
							}
						</h3>
					}
				</div>
				<div class="rc-row">
					@for (a of v.actions; track a.form + a.label) {
						<button
							type="button"
							class="rc-btn"
							[class.primary]="a.tone === 'primary'"
							[class.danger]="a.tone === 'danger'"
							[class.ghost]="a.tone === 'ghost'"
							(click)="act.emit(a)"
						>
							@if (a.tone !== 'ghost') {
								<span
									class="lock"
									aria-hidden="true"
								></span>
							}
							{{ a.label }}
						</button>
					}
				</div>
			</div>
		}
		@if (v.stats.length) {
			<div class="rc-g4">
				@for (s of v.stats; track s.label) {
					<div class="rc-stat">
						<span class="rc-label">{{ s.label }}</span>
						<b>{{ s.value }}</b>
						@if (s.sub) {
							<small>{{ s.sub }}</small>
						}
					</div>
				}
			</div>
		}
		@for (n of v.notes; track $index) {
			<div
				class="rc-banner small"
				[class]="'rc-banner small ' + pill(n.tone)"
			>
				<span [class]="'rc-dot ' + dotOf(n.tone)"></span>
				<div>{{ n.text }}</div>
			</div>
		}
		@if (v.facts.length) {
			<div class="rc-panel">
				<div class="rc-kv">
					@for (f of v.facts; track f[0]) {
						<div>
							<span>{{ f[0] }}</span>
							<em [class]="pill(f[2])">{{ f[1] }}</em>
						</div>
					}
				</div>
			</div>
		}
		@for (t of v.tables; track t.title) {
			<div class="rc-panel">
				<div class="rc-ph">
					<span class="rc-label">{{ t.title }} · {{ t.rows.length }}</span>
				</div>
				<div class="rc-tw">
					<table class="rc-t">
						<thead>
							<tr>
								@for (c of t.columns; track c.key) {
									<th>{{ c.label }}</th>
								}
							</tr>
						</thead>
						<tbody>
							@for (r of t.rows; track r.id + $index) {
								<tr
									[class.sel]="r.id === selected()"
									[attr.tabindex]="t.opens && r.id ? 0 : null"
									[style.cursor]="t.opens && r.id ? 'pointer' : null"
									(click)="openRow(t, r)"
									(keydown.enter)="openRow(t, r)"
								>
									@for (c of t.columns; track c.key; let first = $first) {
										<td
											[class.rc-mono]="c.mono"
											[class]="first && r.tone ? pill(r.tone) : ''"
										>
											@if (first && r.tone) {
												<span [class]="'rc-dot ' + dotOf(r.tone)"></span>
											}
											{{ r.cells[c.key] ?? '—' }}
										</td>
									}
								</tr>
							} @empty {
								<tr>
									<td [attr.colspan]="t.columns.length">{{ t.empty }}</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			</div>
		}
		@if (v.links.length) {
			<div class="rc-row">
				@for (l of v.links; track l.url) {
					<a
						class="rc-btn ghost"
						[href]="l.url"
						target="_blank"
						rel="noopener"
					>
						{{ l.label }} ↗
					</a>
				}
			</div>
		}
	`,
})
export class ProductViewPart {
	readonly view = input.required<ProductView>();
	readonly noun = input('');
	readonly selected = input<string | null>(null);
	readonly act = output<ProductAction>();
	readonly open = output<ProductRow>();
	protected pill(t: Tone): string {
		return t === 'ok'
			? 'ok'
			: t === 'red'
				? 'red'
				: t === 'amber'
					? 'amber'
					: t === 'muted'
						? 'muted'
						: t === 'cy'
							? 'cy'
							: '';
	}
	protected dotOf(t: Tone): string {
		return dot(t);
	}
	protected openRow(t: ProductTable, r: ProductRow): void {
		if (t.opens && r.id) this.open.emit(r);
	}
}

/** The brief's monitor tab: a chart per measure over the chosen range. */
@Component({
	selector: 'rc-product-monitor',
	imports: [SparkLine],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-label">{{ spanLabel() }}</span>
			<div class="rc-row">
				@for (r of ranges; track r) {
					<button
						type="button"
						class="rc-chip"
						[class.on]="r === range()"
						(click)="pickRange.emit(r)"
					>
						{{ r }}
					</button>
				}
			</div>
		</div>
		@for (n of monitor().notes; track $index) {
			<div class="rc-banner small amber">
				<span class="rc-dot amber"></span>
				<div>{{ n.text }}</div>
			</div>
		}
		<div class="rc-g2">
			@for (s of charts(); track s.name) {
				<div class="rc-panel">
					<div class="rc-ph">
						<span class="rc-label">{{ s.name }}</span>
						<span class="rc-mono">now {{ s.last }}{{ s.unit }} · {{ s.min }}–{{ s.max }}{{ s.unit }}</span>
					</div>
					<rc-spark-line
						[values]="s.values"
						[colour]="s.colour"
						[max]="s.unit === '%' ? 100 : undefined"
					/>
					<div class="rc-row between">
						<span class="rc-mono">{{ s.from }}</span>
						<span class="rc-mono">{{ s.to }}</span>
					</div>
				</div>
			}
		</div>
	`,
})
export class ProductMonitorPart {
	readonly monitor = input.required<ProductMonitor>();
	readonly range = input('24h');
	readonly pickRange = output<string>();
	protected readonly ranges = ['1h', '24h', '7d', '30d'];
	private readonly colours = ['#5ed6ff', '#ffb547', '#5dffa8', '#c4b5fd', '#ff8fb1', '#9cc7ff'];
	protected readonly spanLabel = computed(() => `Last ${this.range()} · read from the vendor now`);
	protected readonly charts = computed(() =>
		this.monitor().series.map((s, i) => {
			const values = s.points.map((p) => p[1]);
			const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
			return {
				name: s.name,
				unit: s.unit,
				values,
				// The index wraps round the list, so it always names a colour.
				colour: this.colours[i % this.colours.length] as string,
				last: values.length ? fmt(values[values.length - 1] as number) : '—',
				min: values.length ? fmt(Math.min(...values)) : '—',
				max: values.length ? fmt(Math.max(...values)) : '—',
				from: s.points[0] ? when(new Date((s.points[0][0] as number) * 1000).toISOString()) : '',
				to: s.points.length
					? when(new Date((s.points[s.points.length - 1]?.[0] as number) * 1000).toISOString())
					: '',
			};
		}),
	);
}

/** A change being followed: each step as the vendor reports it. */
@Component({
	selector: 'rc-product-job',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let j = job();
		<div class="rc-panel">
			<div class="rc-row between">
				<div>
					<span class="rc-label">{{ j.form }} · started {{ started() }}</span>
					<h3 class="rc-h">{{ j.target }}</h3>
				</div>
				<span [class]="'rc-pill ' + (j.state === 'done' ? 'ok' : j.state === 'failed' ? 'red' : 'cy')">
					{{ j.state === 'running' ? pct() + '%' : j.state }}
				</span>
			</div>
			<span class="rc-bar do-progress"><i [style.width.%]="pct()"></i></span>
			<div class="rc-checks">
				@for (s of j.steps; track $index) {
					<div class="rc-check">
						<span
							[class]="
								'rc-chk ' +
								(s.state === 'done'
									? 'ok'
									: s.state === 'failed'
										? 'fail'
										: s.state === 'running'
											? 'run'
											: 'queued')
							"
							aria-hidden="true"
						></span>
						<b [class.muted]="s.state === 'queued'">
							{{ s.label }}
							@if (s.detail) {
								<br />
								<span class="rc-mono">{{ s.detail }}</span>
							}
						</b>
						<span class="rc-mono">{{ s.state === 'running' ? 'now' : '' }}</span>
					</div>
				}
			</div>
			<p
				class="rc-note"
				[class.red]="j.state === 'failed'"
			>
				{{ j.message }}
			</p>
		</div>
	`,
})
export class ProductJobPart {
	readonly job = input.required<ProductJob>();
	protected readonly pct = computed(() => {
		const s = this.job().steps;
		return s.length ? Math.round((s.filter((x) => x.state === 'done').length / s.length) * 100) : 0;
	});
	protected readonly started = computed(() => when(this.job().startedAt));
}

/** Every change sent from this screen in this session of the console, newest first, followed live. */
@Component({
	selector: 'rc-product-jobs',
	imports: [ProductJobPart],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (q.isPending()) {
			<div
				class="rc-banner cy small"
				role="status"
			>
				<span
					class="rc-chk run"
					aria-hidden="true"
				></span>
				<div><b>Reading the changes the console is following…</b></div>
			</div>
		}
		@for (j of q.data() ?? []; track j.id) {
			<rc-product-job [job]="j" />
		} @empty {
			@if (q.isSuccess()) {
				<div class="rc-banner small">
					<span class="rc-dot"></span>
					<div>
						<b>Nothing is being created or changed from this screen right now.</b>
						Each change sent here shows below, step by step, as the vendor reports it.
					</div>
				</div>
			}
		}
	`,
})
export class ProductJobsPart {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	readonly screen = input.required<string>();
	protected readonly q = injectQuery(() => ({
		queryKey: ['product-jobs', this.ctx.projectId(), this.ctx.repoId(), this.screen()],
		queryFn: () => this.api.productJobs(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.screen()),
		enabled: !!this.ctx.repoId(),
		refetchInterval: (query: { state: { data?: ProductJob[] } }) =>
			(query.state.data ?? []).some((j) => j.state === 'running') ? 2000 : false,
	}));
}

type Values = Record<string, ProductFieldValue | null>;

/** A product form: its fields, its cost, then the PIN (and the typed name for one-way changes). */
@Component({
	selector: 'rc-product-form',
	imports: [PinBoxes, ProductJobPart],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let f = form();
		<div class="rc-panel">
			<div class="rc-ph">
				<span class="rc-label">{{ f.title }}</span>
			</div>
			@if (f.blocked) {
				<div class="rc-banner small amber">
					<span class="rc-dot amber"></span>
					<div>{{ f.blocked }}</div>
				</div>
			}
			<div class="rc-form">
				@for (fl of f.fields; track fl.key) {
					@switch (fl.type) {
						@case ('cards') {
							<span class="rc-label">{{ fl.label }}</span>
							<div class="do-grid">
								@for (o of fl.options; track o.value) {
									<button
										type="button"
										class="do-card"
										[class.on]="values()[fl.key] === o.value"
										(click)="set(fl.key, o.value)"
									>
										<b>{{ o.label }}</b>
										@if (o.sub) {
											<small>{{ o.sub }}</small>
										}
									</button>
								}
							</div>
						}
						@case ('toggle') {
							<button
								type="button"
								class="do-tick"
								[class.on]="values()[fl.key] === true"
								[attr.aria-pressed]="values()[fl.key] === true"
								(click)="set(fl.key, values()[fl.key] !== true)"
							>
								<i aria-hidden="true"></i>
								<span>
									<b>{{ fl.label }}</b>
									@if (fl.help) {
										<small>{{ fl.help }}</small>
									}
								</span>
							</button>
						}
						@case ('multi') {
							<label>
								{{ fl.label }}
								<span class="rc-row">
									@for (o of fl.options; track o.value) {
										<button
											type="button"
											class="rc-chip"
											[class.on]="has(fl.key, o.value)"
											(click)="flip(fl.key, o.value)"
										>
											{{ o.label }}
										</button>
									} @empty {
										<span class="rc-note">none to choose from</span>
									}
								</span>
							</label>
						}
						@case ('select') {
							<label>
								{{ fl.label }}
								<select
									class="rc-select"
									[attr.aria-label]="fl.label"
									[disabled]="fl.readOnly"
									(change)="set(fl.key, $any($event.target).value)"
								>
									@for (o of fl.options; track o.value) {
										<option
											[value]="o.value"
											[selected]="values()[fl.key] === o.value"
										>
											{{ o.label }}{{ o.sub ? ' — ' + o.sub : '' }}
										</option>
									}
								</select>
							</label>
						}
						@case ('secret') {
							<label>
								{{ fl.label }}
								<span class="rc-msearch">
									<input
										type="password"
										autocomplete="off"
										spellcheck="false"
										[attr.aria-label]="fl.label"
										[value]="values()[fl.key] ?? ''"
										(input)="set(fl.key, $any($event.target).value)"
									/>
								</span>
							</label>
						}
						@case ('textarea') {
							<label>
								{{ fl.label }}
								<textarea
									class="rc-search"
									rows="4"
									[attr.aria-label]="fl.label"
									[value]="values()[fl.key] ?? ''"
									(input)="set(fl.key, $any($event.target).value)"
								></textarea>
							</label>
						}
						@default {
							<label>
								{{ fl.label }}
								<span class="rc-msearch">
									<input
										[type]="fl.type === 'number' ? 'number' : 'text'"
										[attr.aria-label]="fl.label"
										[attr.min]="fl.min"
										[attr.max]="fl.max"
										[readOnly]="fl.readOnly"
										[value]="values()[fl.key] ?? ''"
										(input)="
											set(
												fl.key,
												fl.type === 'number'
													? +$any($event.target).value
													: $any($event.target).value
											)
										"
									/>
								</span>
							</label>
						}
					}
					@if (fl.help && fl.type !== 'toggle') {
						<p class="rc-note">{{ fl.help }}</p>
					}
				}
			</div>
			@if (f.cost) {
				<div class="rc-banner small amber">
					<span class="rc-dot amber"></span>
					<div>
						<b>Costs money:</b>
						{{ f.cost }}
					</div>
				</div>
			}
			@for (n of f.notes; track $index) {
				<div [class]="'rc-banner small ' + (n.tone ?? '')">
					<span [class]="'rc-dot ' + (n.tone === 'muted' ? '' : (n.tone ?? 'cy'))"></span>
					<div>{{ n.text }}</div>
				</div>
			}
			<div class="rc-row end do-nav">
				<button
					type="button"
					class="rc-btn"
					[class.primary]="!f.danger"
					[class.danger]="f.danger"
					[disabled]="!!f.blocked || busy()"
					(click)="confirming.set(true)"
				>
					<span
						class="lock"
						aria-hidden="true"
					></span>
					{{ f.submit }}
				</button>
			</div>
		</div>
		@if (job(); as j) {
			<rc-product-job [job]="j" />
		}
		@if (confirming()) {
			<div
				class="rc-modal-back"
				(keydown.escape)="confirming.set(false)"
			>
				<form
					class="rc-modal"
					role="dialog"
					[attr.aria-label]="f.title"
					(submit)="$event.preventDefault(); send()"
				>
					<h3 class="rc-h">{{ f.title }}</h3>
					@if (f.cost) {
						<p class="rc-p amber">{{ f.cost }}</p>
					}
					<div class="rc-form">
						@if (f.confirmName) {
							<label>
								Type {{ f.confirmName }}
								<span class="rc-msearch">
									<input
										type="text"
										autocomplete="off"
										[attr.aria-label]="'Type ' + f.confirmName + ' to confirm'"
										[value]="typed()"
										(input)="typed.set($any($event.target).value)"
									/>
								</span>
							</label>
						}
						<label>
							PIN
							<rc-pin-boxes
								[label]="'Console PIN to ' + f.submit.toLowerCase()"
								[disabled]="busy()"
								(changed)="pin.set($event)"
							/>
						</label>
					</div>
					@if (error()) {
						<div class="rc-banner small red">
							<span class="rc-dot red"></span>
							<div>{{ error() }}</div>
						</div>
					}
					<div class="rc-row end">
						<button
							type="button"
							class="rc-btn ghost"
							(click)="confirming.set(false)"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="rc-btn"
							[class.primary]="!f.danger"
							[class.danger]="f.danger"
							[disabled]="
								pin().length !== pinLength ||
								busy() ||
								(!!f.confirmName && typed().trim() !== f.confirmName)
							"
						>
							{{ busy() ? 'Sending…' : f.submit }}
						</button>
					</div>
				</form>
			</div>
		}
	`,
})
export class ProductFormPart {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly queries = inject(QueryClient);
	readonly screen = input.required<string>();
	readonly form = input.required<ProductForm>();
	readonly id = input<string | null>(null);
	readonly sent = output<ProductJob>();
	protected readonly pinLength = PIN_LENGTH;
	protected readonly values = signal<Values>({});
	protected readonly confirming = signal(false);
	protected readonly typed = signal('');
	protected readonly pin = signal('');
	protected readonly busy = signal(false);
	protected readonly error = signal('');
	protected readonly jobId = signal<string | null>(null);
	private readonly jobs = injectQuery(() => ({
		queryKey: ['product-jobs', this.ctx.projectId(), this.ctx.repoId(), this.screen()],
		queryFn: () => this.api.productJobs(this.ctx.projectId() ?? '', this.ctx.repoId() ?? '', this.screen()),
		enabled: !!this.jobId(),
		refetchInterval: (query: { state: { data?: ProductJob[] } }) =>
			(query.state.data ?? []).some((j) => j.state === 'running') ? 2000 : false,
	}));
	protected readonly job = computed(() => this.jobs.data()?.find((j) => j.id === this.jobId()) ?? null);

	constructor() {
		effect(() => {
			const f = this.form();
			this.values.set(Object.fromEntries(f.fields.map((x) => [x.key, x.value])));
			this.typed.set('');
			this.error.set('');
		});
		// The vendor's lists change once a followed change finishes; read them again.
		effect(() => {
			const j = this.job();
			if (j && j.state !== 'running')
				void this.queries.invalidateQueries({
					queryKey: ['product', this.ctx.projectId(), this.ctx.repoId(), this.screen()],
				});
		});
	}

	protected set(key: string, v: ProductFieldValue): void {
		this.values.set({ ...this.values(), [key]: v });
	}
	protected has(key: string, v: string): boolean {
		const cur = this.values()[key];
		return Array.isArray(cur) && cur.includes(v);
	}
	protected flip(key: string, v: string): void {
		const cur = this.values()[key];
		const list = Array.isArray(cur) ? cur : [];
		this.set(key, list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
	}

	protected async send(): Promise<void> {
		this.busy.set(true);
		this.error.set('');
		try {
			const values = Object.fromEntries(Object.entries(this.values()).filter(([, v]) => v !== null)) as Record<
				string,
				ProductFieldValue
			>;
			const job = await this.api.sendProductForm(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.screen(),
				this.form().key,
				{
					pin: this.pin(),
					confirm: this.typed(),
					id: this.id(),
					values,
				},
			);
			this.jobId.set(job.id);
			this.queries.setQueryData(
				['product-jobs', this.ctx.projectId(), this.ctx.repoId(), this.screen()],
				(old: ProductJob[] | undefined) => [job, ...(old ?? []).filter((x) => x.id !== job.id)],
			);
			void this.queries.invalidateQueries({
				queryKey: ['product', this.ctx.projectId(), this.ctx.repoId(), this.screen()],
			});
			// A secret is sent once and never kept here.
			const secrets = this.form()
				.fields.filter((f) => f.type === 'secret')
				.map((f) => f.key);
			if (secrets.length)
				this.values.set({ ...this.values(), ...Object.fromEntries(secrets.map((k) => [k, ''])) });
			this.confirming.set(false);
			this.sent.emit(job);
		} catch (err) {
			this.error.set(err instanceof Error ? err.message : 'The console API did not answer.');
		} finally {
			this.busy.set(false);
		}
	}
}

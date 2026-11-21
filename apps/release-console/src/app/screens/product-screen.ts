import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';

import { ProductFormPart, ProductJobsPart, ProductMonitorPart, ProductViewPart } from './product-parts';
import { VendorState } from './vendor-screens';
import { ConsoleApi } from '../data/console-api';
import { ConsoleContext } from '../data/console-context';

import type { ProductAction, ProductRow } from '@saha-textile/release-console-contracts';

/** Which product screens the console API draws from live reads; read once per session. */
export function injectProductScreens() {
	const api = inject(ConsoleApi);
	return injectQuery(() => ({
		queryKey: ['product-screens'],
		queryFn: () => api.productScreens(),
		staleTime: Number.POSITIVE_INFINITY,
	}));
}

/**
 * One tab of a DigitalOcean or Cloudflare product screen, drawn from its live read: the brief's
 * lifecycle (list, create, creating, use, edit, monitor, back up, operate, destroy, history).
 * While it reads, the console's loading banner holds the tab's place; switching the product or the
 * range keeps the last answer on screen with "Refreshing…" until the new one lands.
 */
@Component({
	selector: 'rc-product',
	imports: [VendorState, ProductViewPart, ProductMonitorPart, ProductFormPart, ProductJobsPart],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (kind() === 'jobs') {
			<rc-product-jobs [screen]="screen()" />
		} @else {
			<rc-vendor-state
				[vendor]="vendorName()"
				[answer]="q.data()"
				[pending]="q.isPending()"
				[failed]="q.isError()"
			>
				@if (data(); as t) {
					@if (t.type !== 'jobs' && t.picker; as p) {
						<div class="rc-row between">
							<label class="rc-row">
								<span class="rc-label">{{ p.label }}</span>
								<select
									class="rc-select"
									[attr.aria-label]="p.label"
									(change)="choose($any($event.target).value)"
								>
									@for (o of p.options; track o.value) {
										<option
											[value]="o.value"
											[selected]="o.value === p.value"
										>
											{{ o.label }}
										</option>
									}
								</select>
							</label>
							@if (refreshing()) {
								<span class="rc-pill cy">Refreshing…</span>
							}
						</div>
					} @else if (refreshing()) {
						<div class="rc-row end"><span class="rc-pill cy">Refreshing…</span></div>
					}
					@switch (t.type) {
						@case ('view') {
							<rc-product-view
								[view]="t.view"
								[noun]="noun()"
								[selected]="id()"
								(act)="act($event)"
								(open)="open($event)"
							/>
						}
						@case ('monitor') {
							<rc-product-monitor
								[monitor]="t.monitor"
								[range]="range()"
								(pickRange)="setRange($event)"
							/>
						}
						@case ('form') {
							<rc-product-form
								[screen]="screen()"
								[form]="t.form"
								[id]="t.picker?.value ?? id()"
								(sent)="followUp()"
							/>
						}
					}
				}
			</rc-vendor-state>
		}
		@if (modal(); as m) {
			<div
				class="rc-modal-back"
				(keydown.escape)="modal.set(null)"
			>
				<div
					class="rc-modal"
					role="dialog"
					[attr.aria-label]="m.label"
				>
					<div class="rc-row between">
						<h3 class="rc-h">{{ m.label }}</h3>
						<button
							type="button"
							class="rc-btn ghost"
							(click)="modal.set(null)"
						>
							Close
						</button>
					</div>
					<rc-vendor-state
						[vendor]="vendorName()"
						[answer]="mq.data()"
						[pending]="mq.isPending()"
						[failed]="mq.isError()"
					>
						@if (modalForm(); as f) {
							<rc-product-form
								[screen]="screen()"
								[form]="f"
								[id]="id()"
							/>
						}
					</rc-vendor-state>
				</div>
			</div>
		}
	`,
})
export class ProductScreen {
	private readonly api = inject(ConsoleApi);
	private readonly ctx = inject(ConsoleContext);
	private readonly router = inject(Router);
	private readonly route = inject(ActivatedRoute);
	private readonly screens = injectProductScreens();
	readonly screen = input.required<string>();
	readonly tab = input.required<string>();
	readonly vendor = input<'digitalocean' | 'cloudflare' | 'github'>('digitalocean');
	readonly noun = input('');

	private readonly query = toSignal(
		this.route.queryParamMap.pipe(map((q) => ({ id: q.get('id'), range: q.get('range') }))),
		{
			initialValue: { id: null, range: null },
		},
	);
	protected readonly id = computed(() => this.query().id);
	protected readonly range = computed(() => this.query().range ?? '24h');
	protected readonly vendorName = computed(
		() => ({ cloudflare: 'Cloudflare', github: 'GitHub', digitalocean: 'DigitalOcean' })[this.vendor()],
	);
	protected readonly kind = computed(() =>
		this.tab() === 'creating' || this.tab() === 'restoring' ? 'jobs' : 'tab',
	);

	protected readonly q = injectQuery(() => ({
		queryKey: [
			'product',
			this.ctx.projectId(),
			this.ctx.repoId(),
			this.screen(),
			this.tab(),
			this.id(),
			this.tab() === 'monitor' ? this.range() : '',
		],
		queryFn: () =>
			this.api.productTab(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.screen(),
				this.tab(),
				this.id(),
				this.range(),
			),
		enabled: !!this.ctx.repoId() && this.kind() === 'tab',
		staleTime: 20_000,
		// A running job's steps and a waiting approval keep moving; read them again every few seconds.
		refetchInterval: this.tab() === 'running' || this.screen() === 'approvals' ? 5000 : false,
		// Another product or range of the same tab keeps the last answer on screen while it reads.
		placeholderData: (prev: unknown, prevQuery?: { queryKey: readonly unknown[] }) =>
			prevQuery?.queryKey[3] === this.screen() && prevQuery?.queryKey[4] === this.tab()
				? (prev as never)
				: undefined,
	}));
	protected readonly data = computed(() => {
		const a = this.q.data();
		return a?.state === 'ok' ? a.data : null;
	});
	protected readonly refreshing = computed(() => this.q.isFetching() && !this.q.isPending());

	protected readonly modal = signal<ProductAction | null>(null);
	protected readonly mq = injectQuery(() => ({
		queryKey: [
			'product-form',
			this.ctx.projectId(),
			this.ctx.repoId(),
			this.screen(),
			this.modal()?.form,
			this.id(),
		],
		queryFn: () =>
			this.api.productForm(
				this.ctx.projectId() ?? '',
				this.ctx.repoId() ?? '',
				this.screen(),
				this.modal()?.form ?? '',
				this.id(),
			),
		enabled: !!this.modal(),
	}));
	protected readonly modalForm = computed(() => {
		const a = this.mq.data();
		return a?.state === 'ok' && a.data.type === 'form' ? a.data.form : null;
	});

	private readonly tabs = computed(() => this.screens.data()?.[this.screen()]?.tabs ?? []);

	protected choose(id: string): void {
		void this.router.navigate([], { queryParams: { id }, queryParamsHandling: 'merge', replaceUrl: true });
	}
	protected setRange(range: string): void {
		void this.router.navigate([], { queryParams: { range }, queryParamsHandling: 'merge', replaceUrl: true });
	}
	/** A row opens the product's Use tab. */
	protected open(r: ProductRow): void {
		const use = ['detail', 'bucket'].find((t) => this.tabs().includes(t));
		if (use) void this.router.navigate([], { queryParams: { tab: use, id: r.id }, queryParamsHandling: 'merge' });
	}
	/** A button opens its tab when the screen has one, else its form over the tab. */
	protected act(a: ProductAction): void {
		if (this.tabs().includes(a.form) && a.form !== this.tab())
			void this.router.navigate([], { queryParams: { tab: a.form }, queryParamsHandling: 'merge' });
		else this.modal.set(a);
	}
	/** After a create, the Creating tab follows it when the screen has one. */
	protected followUp(): void {
		const follow = ['creating', 'restoring'].find(
			(t) => this.tabs().includes(t) || this.ctx.repoMenu()?.screens[this.screen()]?.states[t],
		);
		if (follow && (this.tab() === 'create' || this.tab() === 'restore' || this.tab() === 'take'))
			void this.router.navigate([], { queryParams: { tab: follow }, queryParamsHandling: 'merge' });
	}
}

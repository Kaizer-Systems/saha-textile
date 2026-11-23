import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	afterNextRender,
	computed,
	inject,
	input,
	output,
	signal,
	viewChild,
} from '@angular/core';

import { type CoverageNode, coverageBand, metricShare } from '@saha-textile/release-console-contracts';

import { nodeAt, shareText, squarify } from './coverage-view';

const HEADER = 34;

/**
 * Ship › Code › Coverage, the Map (brief CRmpBdP3ce62g1JoCAhh23): one folder's contents as boxes sized by
 * their statements and coloured by how many ran, each folder box showing its own contents faintly. A
 * folder box goes inside it; a file box opens the file at the side.
 */
@Component({
	selector: 'rc-coverage-map',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between">
			<span class="rc-row">
				@for (c of crumbs(); track c.path; let last = $last) {
					@if (last) {
						<b>{{ c.name }}</b>
					} @else {
						<button
							type="button"
							class="rc-btn ghost"
							(click)="focus.emit(c.path)"
						>
							{{ c.name }}
						</button>
						<span class="muted">›</span>
					}
				}
			</span>
			<span class="rc-note">Box size: statements · colour: share of statements that ran</span>
		</div>
		<div
			#area
			class="rc-cov-map"
		>
			@for (b of boxes(); track b.path) {
				<button
					type="button"
					[class]="'rc-cov-box ' + b.band"
					[style.left.px]="b.x"
					[style.top.px]="b.y"
					[style.width.px]="b.w"
					[style.height.px]="b.h"
					[title]="b.title"
					[attr.aria-label]="b.title"
					(click)="pick(b.path, b.folder)"
				>
					@for (s of b.inner; track s.key) {
						<span
							[class]="'rc-cov-box ' + s.band"
							style="pointer-events: none; opacity: 0.55"
							[style.left.px]="s.x"
							[style.top.px]="s.y"
							[style.width.px]="s.w"
							[style.height.px]="s.h"
						></span>
					}
					@if (b.labelled) {
						<b>{{ b.name }}</b>
						<span class="rc-mono">{{ b.text }}%</span>
					}
				</button>
			} @empty {
				<p class="rc-note">Nothing in this folder has code the tests run.</p>
			}
		</div>
	`,
})
export class CoverageMap {
	readonly root = input.required<CoverageNode>();
	readonly focusPath = input('');
	readonly focus = output<string>();
	readonly open = output<string>();

	private readonly area = viewChild.required<ElementRef<HTMLElement>>('area');
	protected readonly size = signal({ w: 0, h: 0 });

	protected readonly crumbs = computed(() => {
		const parts = this.focusPath() ? this.focusPath().split('/') : [];
		return [
			{ path: '', name: this.root().n },
			...parts.map((name, i) => ({ path: parts.slice(0, i + 1).join('/'), name })),
		];
	});
	protected readonly boxes = computed(() => {
		const at = this.focusPath();
		const node = nodeAt(this.root(), at) ?? this.root();
		const { w, h } = this.size();
		const measured = (n: CoverageNode) =>
			(n.k ?? []).flatMap((k) => (k.c && k.c[1] > 0 ? [{ value: k.c[1], item: { k, c: k.c } }] : []));
		return squarify(measured(node), 2, 2, w - 4, h - 4).map((b, i) => {
			const share = metricShare(b.item.c, 'statements');
			const path = at ? `${at}/${b.item.k.n}` : b.item.k.n;
			const inner =
				b.item.k.k && b.w > 60 && b.h > 50
					? squarify(measured(b.item.k), 2, HEADER, b.w - 6, b.h - HEADER - 4).map((s, j) => ({
							key: j,
							band: coverageBand(metricShare(s.item.c, 'statements')),
							x: s.x,
							y: s.y,
							w: Math.max(s.w - 1, 1),
							h: Math.max(s.h - 1, 1),
						}))
					: [];
			return {
				path,
				i,
				name: b.item.k.n,
				folder: !!b.item.k.k,
				band: coverageBand(share),
				text: shareText(share),
				title: `${path} · ${shareText(share)}% of ${b.item.c[1]} statements`,
				labelled: b.w > 46 && b.h > 26,
				inner,
				x: b.x,
				y: b.y,
				w: Math.max(b.w - 2, 1),
				h: Math.max(b.h - 2, 1),
			};
		});
	});

	constructor() {
		const destroy = inject(DestroyRef);
		// Once drawn, the boxes follow the area's size.
		afterNextRender(() => {
			const el = this.area().nativeElement;
			const measure = () => this.size.set({ w: el.clientWidth, h: el.clientHeight });
			measure();
			const watch = new ResizeObserver(measure);
			watch.observe(el);
			destroy.onDestroy(() => watch.disconnect());
		});
	}

	/** A folder box goes inside it; a file box opens the file. */
	protected pick(path: string, folder: boolean): void {
		if (folder) this.focus.emit(path);
		else this.open.emit(path);
	}
}

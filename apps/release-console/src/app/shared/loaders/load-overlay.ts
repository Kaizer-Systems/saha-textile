import {
	ChangeDetectionStrategy,
	Component,
	DestroyRef,
	ElementRef,
	computed,
	effect,
	inject,
	input,
	signal,
	untracked,
} from '@angular/core';

import { QueryClient } from '@tanstack/angular-query-experimental';

import { loaderArt } from './loader-art';

import type { Query } from '@tanstack/angular-query-experimental';

let drawn = 0;
const GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789.:·';

/**
 * One loader drawing (brief N5kmX6DLJv1ECitVUPFHJ8). The SVG is fixed text from loader-art.ts, so it
 * is written as markup; ids inside it get a suffix so two drawings on a page never share one.
 */
@Component({
	selector: 'rc-load-piece',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { class: 'rc-load-piece', 'aria-hidden': 'true' },
	template: '',
})
export class LoadPiece {
	readonly loader = input('reactor');
	private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

	constructor() {
		const n = ++drawn;
		effect(() => {
			const svg = loaderArt(this.loader())
				.svg()
				.replace(/id="(\w+)"/g, `id="$1-${n}"`)
				.replace(/url\(#(\w+)\)/g, `url(#$1-${n})`);
			this.el.nativeElement.innerHTML = `<svg viewBox="0 0 200 200">${svg}</svg>`;
		});
		// The Decoder's words resolve letter by letter from noise.
		const timer = setInterval(() => {
			for (const t of this.el.nativeElement.querySelectorAll<SVGTextElement>('.dec, .dec2')) {
				const word = t.dataset['word'] ?? '';
				const step = ((Number(t.dataset['step']) || 0) + 1) % (word.length + 14);
				t.dataset['step'] = String(step);
				const shown = Math.min(word.length, step);
				t.textContent =
					word.slice(0, shown) +
					Array.from(word.slice(shown), () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join('');
			}
		}, 90);
		inject(DestroyRef).onDestroy(() => clearInterval(timer));
	}
}

type Phase = 'hidden' | 'waiting' | 'shown' | 'out';

/** Shown only after this long, so a fast answer never flashes a loader. */
export const SHOW_AFTER_MS = 150;
/** Once shown, kept at least this long, then faded out. */
export const KEEP_AT_LEAST_MS = 400;
const FADE_MS = 350;
/** Amber, "still waiting", after this long. */
export const SLOW_AFTER_S = 8;
/** "Keep waiting" offered after this long (owner, 21 Nov: 10 s instead of 20). */
export const OFFER_AFTER_S = 10;
/** A refetch with data on screen shows the refresh light only when it takes longer than this. */
const REFRESH_AFTER_MS = 300;
/**
 * A screen that refreshes itself every few seconds shows the light only when one of those reads is
 * slow, so a live screen never flickers but a lagging one says so.
 */
const POLL_REFRESH_AFTER_MS = 1500;

const watched = (q: Query) => q.getObserversCount() > 0 && q.state.fetchStatus === 'fetching';
/** Polling reads (a running job, live charts) refresh every few seconds. */
interface Observed {
	observers: Array<{ options: { refetchInterval?: unknown }; getCurrentResult(): { isPlaceholderData: boolean } }>;
}
const observersOf = (q: Query) => (q as unknown as Observed).observers;
const polling = (q: Query) => observersOf(q).some((o) => !!o.options.refetchInterval);
/**
 * A first read: nothing on screen yet for it. A read whose answer (or failure) is already on screen,
 * or another product or range of the same tab showing the last answer, is a refresh instead, so a
 * screen retrying after a failure keeps its banner visible.
 */
const firstRead = (q: Query) =>
	q.state.status === 'pending' &&
	// A refresh of a read that already answered or failed resets it to pending; it is not a first read.
	q.state.dataUpdateCount === 0 &&
	q.state.errorUpdateCount === 0 &&
	!observersOf(q).some((o) => o.getCurrentResult().isPlaceholderData);

/**
 * The console's loader over the content area (brief N5kmX6DLJv1ECitVUPFHJ8, approved 21 Nov):
 * a screen's first read covers the area with its drawing over a blurred outline of the coming
 * layout, says who and what it is reading and counts real seconds; amber after 8 s, "Keep waiting"
 * after 10 s; a refresh with data on screen only lights a line along the top and the
 * "Refreshing…" chip. The menu and top bar stay usable: the cover takes no clicks.
 */
@Component({
	selector: 'rc-load-overlay',
	imports: [LoadPiece],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		class: 'rc-load',
		'[class.on]': "phase() === 'shown' || phase() === 'out'",
		'[class.out]': "phase() === 'out'",
		'[class.full]': 'full()',
		'[class.slow]': 'slow()',
		'[class.refreshing]': 'refreshing()',
		'[attr.data-loader]': 'loader()',
	},
	template: `
		@if (phase() === 'shown' || phase() === 'out') {
			<div
				class="rc-load-ghost"
				aria-hidden="true"
			>
				<i class="t"></i>
				<div class="g">
					<i></i>
					<i></i>
					<i></i>
					<i></i>
				</div>
				<i class="b"></i>
			</div>
			<div
				class="rc-load-center"
				role="status"
				aria-live="polite"
			>
				<rc-load-piece [loader]="loader()" />
				<div class="rc-load-title">Reading {{ source() }}</div>
				@if (what()) {
					<div class="rc-load-what">{{ what() }}</div>
				}
				<div class="rc-load-time">{{ elapsed().toFixed(1) }} s</div>
				@if (slow()) {
					<div class="rc-load-slow">Still waiting on {{ source() }} · {{ whole() }} s</div>
				}
				@if (offer()) {
					<div class="rc-load-act">
						<button
							type="button"
							class="rc-btn"
							(click)="keepWaiting()"
						>
							Keep waiting
						</button>
					</div>
				}
			</div>
		}
		<span
			class="rc-load-line"
			aria-hidden="true"
		></span>
		<span class="rc-pill cy rc-load-chip">Refreshing…</span>
	`,
})
export class LoadOverlay {
	private readonly client = inject(QueryClient);
	/** Which drawing (loader-art.ts). */
	readonly loader = input('reactor');
	/** Who is being read: DigitalOcean, Cloudflare, GitHub, this Mac, the console. */
	readonly source = input('the console');
	/** What: the screen and its tab. */
	readonly what = input('');
	/** Over the whole window (the console opening) instead of the content area. */
	readonly full = input(false);
	/** Forces the loader on or off; left null, it follows the screen's first reads. */
	readonly active = input<boolean | null>(null);
	/** Off while another loader covers the window. */
	readonly enabled = input(true);

	protected readonly phase = signal<Phase>('hidden');
	private readonly firstReads = signal(0);
	private readonly refetching = signal(0);
	private readonly polled = signal(0);
	protected readonly refreshing = signal(false);
	private readonly startedAt = signal(0);
	private readonly now = signal(Date.now());
	private readonly kept = signal(false);
	protected readonly elapsed = computed(() => Math.max(0, (this.now() - this.startedAt()) / 1000));
	protected readonly whole = computed(() => Math.floor(this.elapsed()));
	protected readonly slow = computed(() => this.phase() === 'shown' && this.elapsed() >= SLOW_AFTER_S);
	protected readonly offer = computed(() => this.slow() && this.elapsed() >= OFFER_AFTER_S && !this.kept());
	private readonly wanted = computed(() => this.enabled() && (this.active() ?? this.firstReads() > 0));

	private timer: ReturnType<typeof setTimeout> | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private shownAt = 0;

	constructor() {
		const count = () => {
			const all = this.client.getQueryCache().getAll().filter(watched);
			this.firstReads.set(all.filter(firstRead).length);
			this.refetching.set(all.filter((q) => !firstRead(q) && !polling(q)).length);
			this.polled.set(all.filter((q) => !firstRead(q) && polling(q)).length);
		};
		count();
		const stop = this.client.getQueryCache().subscribe(() => queueMicrotask(count));
		const tick = setInterval(() => {
			if (this.phase() === 'shown') this.now.set(Date.now());
		}, 100);
		inject(DestroyRef).onDestroy(() => {
			stop();
			clearInterval(tick);
			this.clear();
			if (this.refreshTimer) clearTimeout(this.refreshTimer);
		});
		effect(() => {
			const want = this.wanted();
			untracked(() => this.step(want));
		});
		effect(() => {
			const hidden = this.phase() === 'hidden';
			const after = !hidden
				? null
				: this.refetching() > 0
					? REFRESH_AFTER_MS
					: this.polled() > 0
						? POLL_REFRESH_AFTER_MS
						: null;
			untracked(() => {
				if (this.refreshTimer) clearTimeout(this.refreshTimer);
				this.refreshTimer = null;
				if (after === null) this.refreshing.set(false);
				else this.refreshTimer = setTimeout(() => this.refreshing.set(true), after);
			});
		});
	}

	protected keepWaiting(): void {
		this.kept.set(true);
	}

	private clear(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/** The small state machine: hidden → waiting (150 ms) → shown → (at least 400 ms) out → hidden. */
	private step(want: boolean): void {
		const phase = this.phase();
		if (want) {
			if (phase === 'hidden') {
				this.startedAt.set(Date.now());
				this.now.set(Date.now());
				this.kept.set(false);
				this.phase.set('waiting');
				this.clear();
				this.timer = setTimeout(() => {
					this.shownAt = Date.now();
					this.now.set(Date.now());
					this.phase.set('shown');
				}, SHOW_AFTER_MS);
			} else if (phase === 'out') {
				this.clear();
				this.phase.set('shown');
			}
			return;
		}
		if (phase === 'waiting') {
			this.clear();
			this.phase.set('hidden');
		} else if (phase === 'shown') {
			this.clear();
			this.timer = setTimeout(
				() => {
					this.phase.set('out');
					this.timer = setTimeout(() => this.phase.set('hidden'), FADE_MS);
				},
				Math.max(0, this.shownAt + KEEP_AT_LEAST_MS - Date.now()),
			);
		}
	}
}

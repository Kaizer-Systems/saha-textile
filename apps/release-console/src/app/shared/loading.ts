import { ChangeDetectionStrategy, Component, DestroyRef, Injectable, inject, input, signal } from '@angular/core';

/**
 * How many screens are reading right now by their own means (not through the query cache): every
 * rendered loading marker counts, so the content area's loader covers those reads too.
 */
@Injectable({ providedIn: 'root' })
export class LoadMarks {
	readonly open = signal(0);
}

/**
 * What a screen shows while it reads (owner, 21 Nov: a screen must never sit blank while data
 * arrives). The console's own spinner (`rc-chk run`) in its standard banner, announced to screen
 * readers; it takes the place the content will fill, so nothing jumps when the data lands.
 */
@Component({
	selector: 'rc-loading',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		role: 'status',
		'aria-live': 'polite',
		// The content area's loader shows the reading (brief N5kmX6DLJv1ECitVUPFHJ8); these words stay
		// for screen readers only. The small banner is on the end-of-project clean-up list.
		style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap',
	},
	template: `
		<span
			class="rc-chk run"
			aria-hidden="true"
		></span>
		<div>
			<b>{{ what() }}</b>
			@if (detail()) {
				{{ detail() }}
			}
		</div>
	`,
})
export class Loading {
	constructor() {
		const marks = inject(LoadMarks);
		marks.open.update((n) => n + 1);
		inject(DestroyRef).onDestroy(() => marks.open.update((n) => Math.max(0, n - 1)));
	}
	readonly what = input.required<string>();
	readonly detail = input('');
}

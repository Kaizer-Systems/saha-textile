import { ChangeDetectionStrategy, Component, input } from '@angular/core';

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
	readonly what = input.required<string>();
	readonly detail = input('');
}

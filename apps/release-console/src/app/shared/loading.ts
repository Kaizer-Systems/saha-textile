import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * What a screen shows while it reads (owner, 21 Nov: a screen must never sit blank while data
 * arrives). The console's own spinner (`rc-chk run`) in its standard banner, announced to screen
 * readers; it takes the place the content will fill, so nothing jumps when the data lands.
 */
@Component({
	selector: 'rc-loading',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { class: 'rc-banner cy small', role: 'status', 'aria-live': 'polite' },
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

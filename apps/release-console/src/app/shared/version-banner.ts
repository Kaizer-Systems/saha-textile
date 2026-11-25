import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { VersionWatch } from '../data/version-watch';

/** "15:46": the time of day, as the banner says it. */
export const clock = (iso: string): string =>
	new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * "A newer Release Console is running" (brief 7Hu1SuB3A8qiJzeDwvFZLR, B1 and B2): the console's cyan banner with
 * Reload, or amber with "Reload and lose it" while something typed on the page is not sent yet. Built from the
 * console's own banner, dot and buttons; nothing new is drawn.
 */
@Component({
	selector: 'rc-version-banner',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (watch.newer(); as started) {
			@if (!watch.hidden()) {
				@let typed = watch.typedNotSent();
				<div
					role="status"
					[class]="'rc-banner small ' + (typed ? 'amber' : 'cy')"
				>
					<span [class]="'rc-dot ' + (typed ? 'amber' : 'cy')"></span>
					@if (typed) {
						<div>
							<b>A newer Release Console is running.</b>
							You have typed something on this page that isn’t sent yet. Send or clear it first, or reload
							and lose it.
						</div>
						<button
							type="button"
							class="rc-btn ghost"
							(click)="watch.hidden.set(true)"
						>
							Not yet
						</button>
						<button
							type="button"
							class="rc-btn"
							(click)="watch.reload()"
						>
							Reload and lose it
						</button>
					} @else {
						<div>
							<b>A newer Release Console is running.</b>
							It started at {{ clock(started) }}; this tab is still the one from
							{{ clock(watch.loadedAt) }}. Reload to use it. You stay on this page and stay unlocked.
						</div>
						<button
							type="button"
							class="rc-btn primary"
							(click)="watch.reload()"
						>
							Reload
						</button>
					}
				</div>
			}
		}
	`,
})
export class VersionBanner {
	protected readonly watch = inject(VersionWatch);
	protected readonly clock = clock;
}

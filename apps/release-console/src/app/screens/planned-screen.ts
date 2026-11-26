import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { ScreenInfo } from '../menu/menu.types';

/** A screen whose design is approved but whose live data arrives later in the build order. */
@Component({
	selector: 'rc-planned-screen',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-banner cy small">
			<span class="rc-dot cy"></span>
			<div>
				<b>Designed and approved; live data arrives in the build order.</b>
				The look of this tab is in the Safe Releases Brief.
			</div>
		</div>
		@if (caption()) {
			<div class="rc-panel">
				<div class="rc-ph"><span class="rc-label">What this tab will show</span></div>
				<p class="rc-p">{{ caption() }}</p>
			</div>
		}
		@if (part()) {
			<div class="rc-portal part">
				<div class="rc-portal-h">
					<span
						class="rc-portal-i"
						aria-hidden="true"
					>
						◐
					</span>
					<b>Partly in the console</b>
				</div>
				<p class="rc-p">{{ part() }}</p>
			</div>
		}
	`,
})
export class PlannedScreen {
	readonly info = input<ScreenInfo | undefined>(undefined);
	readonly tab = input('');
	protected readonly caption = computed(() => {
		const s = this.info();
		return s?.captions[this.tab()] ?? Object.values(s?.captions ?? {})[0] ?? '';
	});
	protected readonly part = computed(() => {
		const s = this.info();
		return s?.partStates?.[this.tab()] ?? s?.part ?? '';
	});
}

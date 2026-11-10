import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { OverviewScreen } from './overview-screen';
import { PlannedScreen } from './planned-screen';
import { ServicesScreen } from './services-screen';
import { CONSOLE_MENU } from '../menu/console-menu.data';
import { placeOf } from '../menu/menu-search';

const PLACE = placeOf(CONSOLE_MENU);

/** One console screen: its place in the menu, its tabs (red, yellow or normal) and its body. */
@Component({
	selector: 'rc-screen-page',
	imports: [OverviewScreen, ServicesScreen, PlannedScreen],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@let s = info();
		<div class="rc-row between rc-head">
			<div>
				<span class="rc-crumb">{{ crumb() }}</span>
				<h2 class="rc-title">{{ s?.label ?? 'Unknown screen' }}</h2>
			</div>
			@if (tabs().length > 1) {
				<div class="rc-states">
					@for (t of tabs(); track t.key) {
						@if (t.off) {
							<span
								class="rc-chip off"
								aria-disabled="true"
								[attr.data-tip]="t.off"
							>
								{{ t.label }}
							</span>
						} @else {
							<button
								type="button"
								class="rc-chip"
								[class.on]="t.key === tabKey()"
								[class.part]="!!t.part"
								[attr.data-tip]="t.part"
								(click)="openTab(t.key)"
							>
								{{ t.label }}
							</button>
						}
					}
				</div>
			}
		</div>
		<div class="rc-content">
			@switch (screen()) {
				@case ('overview') {
					<rc-overview-screen />
				}
				@case ('services') {
					<rc-services-screen />
				}
				@default {
					<rc-planned-screen
						[screen]="screen()"
						[tab]="tabKey()"
					/>
				}
			}
		</div>
	`,
})
export class ScreenPage {
	private readonly router = inject(Router);
	readonly screen = input('overview');
	readonly tab = input<string | undefined>(undefined);

	protected readonly info = computed(() => CONSOLE_MENU.screens[this.screen()]);
	protected readonly crumb = computed(() => {
		const p = PLACE.get(this.screen()) ?? [];
		return this.screen() === 'overview' || !p.length ? '' : `${p.join(' › ')} ›`;
	});
	protected readonly tabs = computed(() => {
		const s = this.info();
		if (!s) return [];
		return Object.entries(s.states)
			.filter(([, label]) => !!label)
			.map(([key, label]) => ({
				key,
				label,
				off: s.offStates?.[key] ?? null,
				part: s.partStates?.[key] ?? null,
			}));
	});
	protected readonly tabKey = computed(() => {
		const wanted = this.tab();
		const usable = this.tabs().filter((t) => !t.off);
		return usable.find((t) => t.key === wanted)?.key ?? usable[0]?.key ?? '';
	});

	protected openTab(key: string): void {
		void this.router.navigate([], { queryParams: { tab: key }, queryParamsHandling: 'merge' });
	}
}

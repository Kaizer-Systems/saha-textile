import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { Icon } from '../shared/icons';

/** A page title with its breadcrumb and, when given, tabs (the brief's `rc-head`). */
@Component({
	selector: 'rc-page-head',
	imports: [Icon],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between rc-head">
			<div>
				<span class="rc-crumb">{{ crumb() }}</span>
				<h2 class="rc-title">
					@if (icon()) {
						<rc-icon [name]="icon()" />
					}
					{{ title() }}
				</h2>
			</div>
			@if (tabs().length) {
				<div class="rc-states">
					@for (t of tabs(); track t[0]) {
						<button
							type="button"
							class="rc-chip"
							[class.on]="t[0] === tab()"
							(click)="open(t[0])"
						>
							@if (tabIcons()[t[0]]; as ti) {
								<rc-icon [name]="ti" />
							}
							{{ t[1] }}
						</button>
					}
				</div>
			}
		</div>
	`,
})
export class PageHead {
	private readonly router = inject(Router);
	readonly crumb = input('');
	readonly title = input.required<string>();
	readonly tabs = input<[string, string][]>([]);
	readonly tab = input('');
	/** An Iconify `set/name` before the title. */
	readonly icon = input('');
	/** Icons of the tabs, by tab key. */
	readonly tabIcons = input<Record<string, string>>({});

	protected open(tab: string): void {
		void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
	}
}

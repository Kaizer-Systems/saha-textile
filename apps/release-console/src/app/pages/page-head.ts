import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

/** A page title with its breadcrumb and, when given, tabs (the brief's `rc-head`). */
@Component({
	selector: 'rc-page-head',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="rc-row between rc-head">
			<div>
				<span class="rc-crumb">{{ crumb() }}</span>
				<h2 class="rc-title">{{ title() }}</h2>
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

	protected open(tab: string): void {
		void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge' });
	}
}

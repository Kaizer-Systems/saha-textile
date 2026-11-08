import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectStorefrontSearchSettingsQuery } from '@data-access/queries/search-term.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { SearchTermService } from '@data-access/services/search-term.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

/**
 * Store front › Storefront settings (brief approved 2026-11-08): small shop-wide switches, one
 * group per side tab in the Theme Options layout. Search is the first group.
 */
@Component({
	selector: 'app-storefront-setting',
	templateUrl: './storefront-setting.html',
	imports: [
		PageWrapper,
		FormsModule,
		NgbNavModule,
		FormFields,
		AdvancedDropdown,
		Button,
		HasPermissionDirective,
		TranslocoModule,
	],
})
export class StorefrontSetting {
	private terms = inject(SearchTermService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);

	active = 'search';
	private readonly settingsQuery = injectStorefrontSearchSettingsQuery();
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	readonly categories = computed(() => this.categoriesQuery.data()?.data ?? []);
	readonly showFirst = signal<string[]>([]);

	constructor() {
		effect(() => {
			const settings = this.settingsQuery.data();
			if (settings) this.showFirst.set([...settings.showFirstCategoryIds]);
		});
	}

	selectShowFirst(ids: string[]) {
		if (Array.isArray(ids)) this.showFirst.set(ids.map(String));
	}

	submit() {
		this.terms.saveSearchSettings({ showFirstCategoryIds: this.showFirst() }).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['storefront-settings'] });
				this.notifier.showSuccess(this.transloco.translate('storefront_settings_saved'));
			},
			error: () => this.notifier.showError(this.transloco.translate('storefront_settings_rejected')),
		});
	}
}

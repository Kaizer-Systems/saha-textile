import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import type { BundlePriceMethodRow } from '@saha-textile/contracts';

/**
 * Products › Bundle price methods (owner, 22 Nov 2026): the "Set price is" list as records, with add, edit, switch
 * off and remove. The five seeded ones are ordinary records too.
 */
@Component({
	selector: 'app-price-method-list',
	template: `
		<app-page-wrapper
			[gridClass]="'col-sm-12'"
			[title]="'bundle_price_methods'"
		>
			<div button>
				<a
					[routerLink]="['/product/bundle-price-methods', 'new']"
					class="align-items-center btn btn-theme d-flex"
				>
					<i class="ri-add-line"></i>
					{{ 'add_price_method' | transloco }}
				</a>
			</div>
			<p class="help-text">{{ 'bundle_methods_help' | transloco }}</p>
			<div class="table-responsive">
				<table class="all-package theme-table no-footer table">
					<thead>
						<tr>
							<th>{{ 'name' | transloco }}</th>
							<th>{{ 'bundle_method_numbers' | transloco }}</th>
							<th>{{ 'bundle_method_used_by' | transloco }}</th>
							<th>{{ 'status' | transloco }}</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						@for (row of rows(); track row.id) {
							<tr>
								<td>
									{{ row.name[lang] || row.name['en'] }}
									<small class="help-text d-block">{{ row.help[lang] || row.help['en'] }}</small>
								</td>
								<td>
									@for (input of row.inputs; track input.code) {
										<span class="badge bg-light text-dark me-1">
											{{ input.label[lang] || input.label['en'] }}
										</span>
									}
								</td>
								<td>{{ row.usedBy }}</td>
								<td>
									<div [class]="row.active ? 'status-in_stock' : 'status-pending'">
										<span>{{ (row.active ? 'active' : 'inactive') | transloco }}</span>
									</div>
								</td>
								<td class="text-nowrap">
									<a
										class="btn btn-sm btn-outline-secondary me-1"
										[routerLink]="['/product/bundle-price-methods', row.id]"
										[title]="'edit' | transloco"
									>
										<i class="ri-pencil-line"></i>
									</a>
									<button
										type="button"
										class="btn btn-sm btn-outline-danger"
										[disabled]="row.usedBy > 0"
										[title]="'delete' | transloco"
										(click)="remove(row)"
									>
										<i class="ri-delete-bin-line"></i>
									</button>
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</app-page-wrapper>
	`,
	imports: [PageWrapper, RouterModule, TranslocoModule],
})
export class PriceMethodList {
	private readonly bundles = inject(BundleService);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	readonly lang = this.transloco.getActiveLang() || 'en';
	readonly rows = signal<BundlePriceMethodRow[]>([]);

	constructor() {
		if (isPlatformBrowser(inject(PLATFORM_ID))) void this.load();
	}

	async load(): Promise<void> {
		this.rows.set(await firstValueFrom(this.bundles.methods()));
	}

	async remove(row: BundlePriceMethodRow): Promise<void> {
		try {
			await firstValueFrom(this.bundles.deleteMethod(row.id));
			this.notifier.showSuccess(this.transloco.translate('bundle_method_removed'));
			await this.load();
		} catch {
			this.notifier.showError(this.transloco.translate('bundle_method_in_use'));
		}
	}
}

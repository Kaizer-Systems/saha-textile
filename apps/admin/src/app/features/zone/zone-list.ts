import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { apiProblem, shortDate } from '@core/purchasing/purchasing-format';
import { ZONES_KEY, ZonesGateway, injectZonesQuery } from '@core/zones/zones.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import type { AdminZoneRow } from '@saha-textile/contracts';

/** The pill a zone's status shows. */
export function zonePill(status: AdminZoneRow['status']): string {
	return status === 'live' ? 'success' : status === 'archived' ? 'cancelled' : 'pending';
}

/**
 * Customers › Zones (DEC-B2B-ZONES): RETAIL first (shop pricing, no rules, never deleted), then
 * the zones staff built, with their status, rules, the businesses in each, and any mistakes the
 * rules still have. A zone some business uses can't be deleted.
 */
@Component({
	selector: 'app-zone-list',
	template: `
		<app-page-wrapper
			[gridClass]="'col-sm-12'"
			[title]="'zone_zones'"
		>
			<div
				*hasPermission="'price_zone.create'"
				button
			>
				<a
					[routerLink]="['/zones/create']"
					class="align-items-center btn btn-theme d-flex"
				>
					<i class="ri-add-line"></i>
					{{ 'zone_add_zone' | transloco }}
				</a>
			</div>
			<p class="help-text">{{ 'zone_list_help' | transloco }}</p>
			<div class="table-responsive datatable-wrapper border-table">
				<table class="all-package theme-table no-footer table">
					<thead>
						<tr>
							<th>{{ 'zone_name' | transloco }}</th>
							<th>{{ 'zone_code' | transloco }}</th>
							<th>{{ 'ord_col_status' | transloco }}</th>
							<th class="text-end">{{ 'zone_rules' | transloco }}</th>
							<th class="text-end">{{ 'biz_businesses' | transloco }}</th>
							<th>{{ 'zone_updated' | transloco }}</th>
							<th>
								<span class="visually-hidden">{{ 'zone_actions' | transloco }}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						@for (zone of rows(); track zone.id) {
							<tr>
								<td>
									<a [routerLink]="['/zones', zone.id]">
										<h6 class="mb-0">{{ zone.name }}</h6>
									</a>
									@if (zone.problems.length) {
										<small class="text-danger">
											{{ 'zone_has_problems' | transloco: { count: zone.problems.length } }}
										</small>
									}
								</td>
								<td>{{ zone.code }}</td>
								<td>
									<div [class]="'status-' + pill(zone.status)">
										<span>{{ 'zone_status_' + zone.status | transloco }}</span>
									</div>
								</td>
								<td class="text-end">{{ zone.system ? '—' : zone.ruleCount }}</td>
								<td class="text-end">{{ zone.businessCount }}</td>
								<td>{{ day(zone.updatedAt) }}</td>
								<td class="text-end">
									<a
										[routerLink]="['/zones', zone.id]"
										[title]="'zone_open' | transloco"
										[attr.aria-label]="'zone_open' | transloco"
									>
										<i class="ri-eye-line"></i>
									</a>
									@if (!zone.system && zone.businessCount === 0) {
										<a
											*hasPermission="'price_zone.destroy'"
											href="javascript:void(0)"
											class="ms-2"
											[title]="'zone_delete' | transloco"
											[attr.aria-label]="'zone_delete' | transloco"
											(click)="remove(zone)"
										>
											<i class="ri-delete-bin-line"></i>
										</a>
									}
								</td>
							</tr>
						}
					</tbody>
				</table>
			</div>
		</app-page-wrapper>
	`,
	imports: [HasPermissionDirective, PageWrapper, RouterModule, TranslocoModule],
})
export class ZoneList {
	private readonly gateway = inject(ZonesGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	readonly query = injectZonesQuery();
	readonly pill = zonePill;

	rows(): AdminZoneRow[] {
		return [...(this.query.data() ?? [])].sort((a, b) =>
			a.system ? -1 : b.system ? 1 : a.name.localeCompare(b.name),
		);
	}

	day(value: string | null | undefined): string {
		return shortDate(value);
	}

	async remove(zone: AdminZoneRow): Promise<void> {
		const yes = await askConfirm(this.modals, {
			icon: 'ri-delete-bin-line',
			title: 'zone_delete_title',
			body: 'zone_delete_body',
			params: { name: zone.name },
			yes: 'zone_delete',
		});
		if (!yes) return;
		try {
			await firstValueFrom(this.gateway.remove(zone.id));
			void this.queryClient.invalidateQueries({ queryKey: [...ZONES_KEY] });
			this.notifier.showSuccess(this.transloco.translate('zone_deleted'));
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
	}
}

import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { COUPONS_KEY, CouponsGateway, injectCouponListQuery } from '@core/coupons/coupons.gateway';
import { apiProblem, escapeHtml, rupees, shortDate } from '@core/purchasing/purchasing-format';
import { tablePage } from '@core/purchasing/purchasing.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { CouponBulkResult, CouponListQuery, CouponListRow } from '@saha-textile/contracts';

export interface CouponTableRow {
	id: string;
	code: string;
	gives: string;
	appliesTo: string;
	combines: string;
	used: string;
	valid: string;
	/** The row switch: 1 on, 0 off (the shared table's switch column). */
	status: number;
	statusLabel: string;
	statusClass: string;
	locked: boolean;
}

/** A coupon as the cp01 table draws it. Every value is escaped: titles come from people. */
export function toCouponRow(row: CouponListRow, translate: (key: string, params?: object) => string): CouponTableRow {
	const gives =
		row.kind === 'percentOff'
			? translate('cpn_gives_percent', { value: row.value })
			: row.kind === 'amountOff'
				? translate('cpn_gives_amount', { amount: rupees(row.value) })
				: translate('cpn_gives_free_delivery');
	const valid =
		row.validFrom || row.validUntil
			? `${row.validFrom ? shortDate(row.validFrom) : '…'} – ${row.validUntil ? shortDate(row.validUntil) : '…'}`
			: translate('cpn_always');
	return {
		id: row.id,
		code: `<h6 class="mb-0">${escapeHtml(row.code)}</h6><small class="text-muted">${escapeHtml(row.title)}</small>`,
		gives: escapeHtml(gives),
		appliesTo: escapeHtml(row.appliesTo),
		combines: escapeHtml(translate(row.combines ? 'cpn_yes' : 'cpn_no')),
		used: `${row.usedCount.toLocaleString('en-IN')} / ${row.totalUses === null ? '—' : row.totalUses.toLocaleString('en-IN')}`,
		valid: escapeHtml(valid),
		status: row.enabled ? 1 : 0,
		statusLabel: row.expired ? 'cpn_ended' : row.enabled ? 'cpn_on' : 'cpn_off',
		statusClass: row.expired ? 'status-failed' : row.enabled ? 'status-success' : 'status-pending',
		locked: row.expired,
	};
}

/**
 * Products › Coupons (cp01; owner, 2026-11-20): what each coupon gives, what it applies to, whether it
 * combines, uses against its limit, dates and status. Ticks with bulk Delete, Turn on and Turn off on
 * every ticked coupon (a coupon used on orders is turned off, never deleted), and a row switch.
 */
@Component({
	selector: 'app-coupon-list',
	template: `
		<app-page-wrapper
			[gridClass]="'col-sm-12'"
			[title]="'coupons'"
		>
			<div
				*hasPermission="'coupon.create'"
				button
			>
				<a
					[routerLink]="['/coupon/create']"
					class="align-items-center btn btn-theme d-flex"
				>
					<i class="ri-add-line"></i>
					{{ 'add_coupon' | transloco }}
				</a>
			</div>
			<app-table
				[tableConfig]="tableConfig()"
				[hasCheckbox]="true"
				[selectionKey]="'coupons'"
				[searchPlaceholder]="'cpn_search_placeholder'"
				(tableChanged)="onTableChange($event)"
				(rowClicked)="edit($event)"
				(action)="onAction($event)"
			>
				<div
					tableFilters
					class="d-flex flex-wrap gap-2"
				>
					@for (item of filters; track item.key) {
						<button
							type="button"
							class="align-items-center btn btn-sm d-flex"
							[class.btn-theme]="filter() === item.key"
							[class.btn-outline]="filter() !== item.key"
							[attr.aria-pressed]="filter() === item.key"
							(click)="setFilter(item.key)"
						>
							{{ item.label | transloco }} ({{ counts()[item.key] }})
						</button>
					}
				</div>
			</app-table>
		</app-page-wrapper>
	`,
	imports: [HasPermissionDirective, PageWrapper, RouterModule, Table, TranslocoModule],
})
export class CouponList {
	private readonly router = inject(Router);
	private readonly gateway = inject(CouponsGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly queryClient = inject(QueryClient);

	private readonly table = viewChild(Table);
	readonly filter = signal<CouponListQuery['filter']>('all');
	private readonly params = signal<Params>({});
	readonly query = injectCouponListQuery(() => ({ filter: this.filter(), ...tablePage(this.params()) }));
	readonly counts = computed(() => this.query.data()?.counts ?? { all: 0, on: 0, off: 0, expired: 0 });
	readonly filters: ReadonlyArray<{ key: CouponListQuery['filter']; label: string }> = [
		{ key: 'all', label: 'cpn_filter_all' },
		{ key: 'on', label: 'cpn_filter_on' },
		{ key: 'off', label: 'cpn_filter_off' },
		{ key: 'expired', label: 'cpn_filter_expired' },
	];

	readonly tableConfig = signal<ITableConfig<CouponTableRow>>({
		columns: [
			{ title: 'cpn_code', dataField: 'code', width: 200 },
			{ title: 'cpn_gives', dataField: 'gives' },
			{ title: 'cpn_applies_to', dataField: 'appliesTo', width: 240 },
			{ title: 'cpn_combines', dataField: 'combines' },
			{ title: 'cpn_used_limit', dataField: 'used', align: 'end' },
			{ title: 'cpn_valid', dataField: 'valid' },
			{
				title: 'cpn_status',
				dataField: 'status',
				type: 'switch',
				labelField: 'statusLabel',
				labelClassField: 'statusClass',
				lockField: 'locked',
			},
		],
		rowActions: [
			{ label: 'cpn_edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'coupon.edit' },
			{
				label: 'cpn_duplicate',
				actionToPerform: 'duplicate',
				icon: 'ri-file-copy-line',
				permission: 'coupon.create',
			},
		],
		bulkActions: [
			{ label: 'cpn_turn_on', actionToPerform: 'bulk_on', icon: 'ri-toggle-fill', permission: 'coupon.edit' },
			{ label: 'cpn_turn_off', actionToPerform: 'bulk_off', icon: 'ri-toggle-line', permission: 'coupon.edit' },
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.query.data();
			const translate = (key: string, params?: object) => this.transloco.translate(key, params);
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.items.map((row) => toCouponRow(row, translate)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	setFilter(filter: CouponListQuery['filter']): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as CouponTableRow | undefined;
		const ids = (Array.isArray(action.data) ? action.data : []).map(String);
		if (action.actionToPerform === 'edit' && row) this.edit(row);
		else if (action.actionToPerform === 'duplicate' && row)
			void this.router.navigate(['/coupon/create'], { queryParams: { from: row.id } });
		else if (action.actionToPerform === 'status' && row) void this.switch(row);
		else if (action.actionToPerform === 'deleteAll') void this.bulk('delete', ids);
		else if (action.actionToPerform === 'bulk_on') void this.bulk('turnOn', ids);
		else if (action.actionToPerform === 'bulk_off') void this.bulk('turnOff', ids);
	}

	edit(row: CouponTableRow): void {
		void this.router.navigate(['/coupon/edit', row.id]);
	}

	/** The row switch: the table has already flipped `status`. */
	private async switch(row: CouponTableRow): Promise<void> {
		try {
			await firstValueFrom(this.gateway.switch(row.id, Number(row.status) === 1));
			this.notifier.showSuccess(
				this.transloco.translate(Number(row.status) === 1 ? 'cpn_switched_on' : 'cpn_switched_off'),
			);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
		await this.refresh();
	}

	/** One call for every ticked coupon; one note counts the changes and names any refused. */
	private async bulk(action: 'delete' | 'turnOn' | 'turnOff', ids: string[]): Promise<void> {
		if (!ids.length) return;
		try {
			const result: CouponBulkResult = await firstValueFrom(
				action === 'delete'
					? this.gateway.bulkDelete({ action, ids })
					: this.gateway.bulkSwitch({ action, ids }),
			);
			this.notifier.showSuccess(this.transloco.translate(`cpn_bulk_${action}`, { count: result.done.length }));
			if (result.refused.length) {
				this.notifier.showError(
					this.transloco.translate('cpn_bulk_refused', {
						codes: result.refused.map((row) => row.code).join(', '),
					}),
				);
			}
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('ord_action_failed')));
		}
		await this.refresh();
	}

	private async refresh(): Promise<void> {
		await this.queryClient.invalidateQueries({ queryKey: [...COUPONS_KEY] });
	}
}

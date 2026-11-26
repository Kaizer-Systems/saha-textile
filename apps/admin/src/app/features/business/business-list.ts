import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { injectBusinessesQuery } from '@core/business/businesses.gateway';
import { escapeHtml, rupees } from '@core/purchasing/purchasing-format';
import { tablePage } from '@core/purchasing/purchasing.gateway';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { BusinessListQuery, BusinessListRow } from '@saha-textile/contracts';

export type BusinessFilter = 'all' | 'customer' | 'supplier' | 'creditOnHold' | 'blocked';

export interface BusinessTableRow {
	id: string;
	business: string;
	gstin: string;
	roles: string;
	zone: string;
	credit: string;
	owesUs: string;
	weOwe: string;
	standing: string;
}

const STANDING_PILL = { active: 'success', creditOnHold: 'pending', blocked: 'failed' } as const;

/** A business as the bz01 table draws it. Every value is escaped: names come from people. */
export function toBusinessRow(
	row: BusinessListRow,
	translate: (key: string, params?: object) => string,
): BusinessTableRow {
	const name = row.tradeName || row.legalName;
	const under = [row.tradeName && row.tradeName !== row.legalName ? row.legalName : null, row.stateName].filter(
		Boolean,
	);
	const inactive = row.active
		? ''
		: ` <span class="badge bg-secondary">${escapeHtml(translate('biz_inactive'))}</span>`;
	const roles = [
		row.buysFromUs ? `<span class="badge badge-theme">${escapeHtml(translate('biz_buys_from_us'))}</span>` : '',
		row.sellsToUs ? `<span class="badge badge-theme">${escapeHtml(translate('biz_sells_to_us'))}</span>` : '',
	]
		.filter(Boolean)
		.join(' ');
	const none = '<span class="text-muted">—</span>';
	return {
		id: row.id,
		business: `<h6 class="mb-0">${escapeHtml(name)}${inactive}</h6><small class="text-muted">${escapeHtml(under.join(' · '))}</small>`,
		gstin: row.gstin ? escapeHtml(row.gstin) : none,
		roles,
		zone: row.zone ? escapeHtml(row.zone.name) : none,
		credit:
			row.buysFromUs && row.creditLimitINR !== null
				? escapeHtml(
						translate('biz_credit_used_of', {
							used: rupees(row.creditUsedINR ?? 0),
							limit: rupees(row.creditLimitINR),
						}),
					)
				: `<span class="text-muted">${escapeHtml(translate('biz_not_a_customer'))}</span>`,
		owesUs: row.buysFromUs ? rupees(Math.max(0, row.owesUsINR)) : none,
		weOwe: row.sellsToUs && row.weOweINR > 0 ? rupees(row.weOweINR) : none,
		standing: row.standing
			? `<div class="status-${STANDING_PILL[row.standing]}"><span>${escapeHtml(translate(`ord_standing_${row.standing}`))}</span></div>`
			: none,
	};
}

/** The filter as the list query takes it. */
export function businessFilterQuery(filter: BusinessFilter): Partial<BusinessListQuery> {
	if (filter === 'customer' || filter === 'supplier') return { role: filter };
	if (filter === 'creditOnHold' || filter === 'blocked') return { role: 'customer', standing: filter };
	return { role: 'all' };
}

/**
 * Admin › Customers › Businesses (bz01): one record per business, whether it buys from us, sells to
 * us or both; roles, zone, credit used, both balances side by side (never set off here), standing.
 * The same records appear under Purchases › Suppliers when they sell to us.
 */
@Component({
	selector: 'app-business-list',
	templateUrl: './business-list.html',
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class BusinessList {
	private readonly router = inject(Router);
	private readonly transloco = inject(TranslocoService);

	private readonly table = viewChild(Table);
	readonly filter = signal<BusinessFilter>('all');
	private readonly params = signal<Params>({});
	readonly query = injectBusinessesQuery(() => ({
		...businessFilterQuery(this.filter()),
		...tablePage(this.params()),
	}));
	readonly counts = computed<Record<BusinessFilter, number>>(() => {
		const counts = this.query.data()?.counts;
		return {
			all: counts?.all ?? 0,
			customer: counts?.customer ?? 0,
			supplier: counts?.supplier ?? 0,
			creditOnHold: counts?.creditOnHold ?? 0,
			blocked: counts?.blocked ?? 0,
		};
	});
	readonly filters: ReadonlyArray<{ key: BusinessFilter; label: string }> = [
		{ key: 'all', label: 'biz_filter_all' },
		{ key: 'customer', label: 'biz_filter_customer' },
		{ key: 'supplier', label: 'biz_filter_supplier' },
		{ key: 'creditOnHold', label: 'biz_filter_credit_on_hold' },
		{ key: 'blocked', label: 'biz_filter_blocked' },
	];

	readonly tableConfig = signal<ITableConfig<BusinessTableRow>>({
		columns: [
			{ title: 'biz_business', dataField: 'business', width: 240 },
			{ title: 'gstin', dataField: 'gstin', width: 170 },
			{ title: 'biz_roles', dataField: 'roles' },
			{ title: 'biz_zone', dataField: 'zone' },
			{ title: 'biz_credit_used', dataField: 'credit' },
			{ title: 'biz_they_owe_us', dataField: 'owesUs', align: 'end' },
			{ title: 'biz_we_owe_them', dataField: 'weOwe', align: 'end' },
			{ title: 'biz_standing', dataField: 'standing' },
		],
		rowActions: [
			{ label: 'biz_view', actionToPerform: 'view', icon: 'ri-eye-line', permission: 'business.index' },
			{ label: 'biz_edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'business.edit' },
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
				data: page ? page.items.map((row) => toBusinessRow(row, translate)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	/** A new filter starts again at page 1, in the table's pager too. */
	setFilter(filter: BusinessFilter): void {
		const table = this.table();
		if (table) table.tableData['page'] = 1;
		this.filter.set(filter);
		this.params.update((params) => ({ ...params, page: 1 }));
	}

	onTableChange(data?: Params): void {
		this.params.set({ ...data });
	}

	onAction(action: ITableClickedAction): void {
		const row = action.data as BusinessTableRow | undefined;
		if (!row) return;
		if (action.actionToPerform === 'edit') void this.router.navigate(['/businesses', row.id, 'edit']);
		else this.view(row);
	}

	view(row: BusinessTableRow): void {
		void this.router.navigate(['/businesses', row.id]);
	}
}

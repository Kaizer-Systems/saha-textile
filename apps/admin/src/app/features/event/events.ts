import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { utcToIstInput } from '@core/i18n/ist-time';
import { injectMissingLanguage } from '@core/i18n/missing-language';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectShopEventsQuery } from '@data-access/queries/shop-event.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { EVENT_STATUS_PILL, IShopEventRow, ShopEventService } from '@data-access/services/shop-event.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MissingLanguageNotice } from '@shared/ui/missing-language-notice/missing-language-notice';
import { Table } from '@shared/ui/table/table';

import type { ShopEvent } from '@saha-textile/contracts';

/** `2027-09-27T23:59` → `27 Sep 2027, 23:59 IST`: the admin always reads India time. */
export function istLabel(iso: string | null): string {
	if (!iso) return '—';
	const [date = '', time = ''] = utcToIstInput(iso).split('T');
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
	return `${d} ${month} ${y}, ${time} IST`;
}

/** All events: the shared admin table, as on Coupons and Blog. */
@Component({
	selector: 'app-events',
	templateUrl: './events.html',
	imports: [MissingLanguageNotice, PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Events {
	private router = inject(Router);
	private events = inject(ShopEventService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);

	private readonly params = signal<Params>({});
	/** Opened from Settings › Languages: only items still missing one language's text. */
	readonly missing = injectMissingLanguage('events');
	readonly eventsQuery = injectShopEventsQuery(() => ({ ...this.params(), missing: this.missing.code() }));

	readonly tableConfig = signal<ITableConfig<IShopEventRow>>({
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'name', dataField: 'name', sortable: true },
			{ title: 'type', dataField: 'type_label' },
			{ title: 'status', dataField: 'status_pill' },
			{ title: 'starts_at_ist', dataField: 'starts_at', sortable: true, sort_direction: 'desc' },
			{ title: 'ends_at_ist', dataField: 'ends_at', sortable: true },
		],
		rowActions: [
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'event.edit' },
			// A published event is cancelled instead, so its record stays (owner brief).
			{
				label: 'delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'event.destroy',
				rowStatuses: ['draft'],
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.eventsQuery.data();
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.data.map((event) => this.row(event)) : [],
				total: page?.total ?? 0,
			}));
		});
	}

	private row(event: ShopEvent): IShopEventRow {
		const passed = event.status === 'draft' && !!event.startsAt && Date.parse(event.startsAt) <= Date.now();
		const label = this.transloco.translate(passed ? 'event_start_passed' : `event_status_${event.status}`);
		const pill = passed ? 'danger' : EVENT_STATUS_PILL[event.status];
		return {
			id: event.id,
			name: event.name,
			type_label: this.transloco.translate(event.type === 'sale' ? 'sale' : 'launch'),
			status_pill: `<div class="status-${pill}"><span>${label}</span></div>`,
			status: event.status,
			starts_at: istLabel(event.startsAt),
			ends_at: event.type === 'sale' ? istLabel(event.endsAt) : '—',
			event,
		};
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform === 'edit') this.edit(action.data);
		else if (action.actionToPerform === 'delete') this.delete(action.data);
	}

	edit(row: IShopEventRow) {
		void this.router.navigateByUrl(`/event/edit/${row.id}`);
	}

	/** Drafts only; a published event is cancelled from its form so the record stays. */
	delete(row: IShopEventRow) {
		if (row.status !== 'draft') {
			this.notifier.showError(this.transloco.translate('event_delete_drafts_only'));
			return;
		}
		this.events.remove(row.id).subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('event_deleted'));
				void this.queryClient.invalidateQueries({ queryKey: ['shop-events'] });
			},
			error: () => this.notifier.showError(this.transloco.translate('event_rejected')),
		});
	}
}

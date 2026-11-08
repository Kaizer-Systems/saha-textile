import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { SEARCH_TERM_GO_LIVE_WORDS, goLiveLabels } from '@core/catalog/go-live-report';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectSearchTermsQuery } from '@data-access/queries/search-term.queries';
import { NotificationService } from '@data-access/services/notification.service';
import {
	type ISearchTermRow,
	SearchTermService,
	type SearchTermStatusResult,
} from '@data-access/services/search-term.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Table } from '@shared/ui/table/table';

import type { SearchTerm, SearchTermStatus } from '@saha-textile/contracts';

/** A word as the table draws it. */
export function toRow(
	term: SearchTerm,
	translate: (key: string, params?: Record<string, unknown>) => string,
): ISearchTermRow {
	const others = Object.entries(term.name)
		.filter(([locale]) => locale !== 'en')
		.map(([, name]) => name);
	return {
		id: term.id,
		name: [term.name['en'] ?? '', ...others].filter(Boolean).join(' · '),
		spellings: Object.values(term.spellings).flat().join(', '),
		finds: translate('search_word_finds', {
			categories: term.categoryIds.length,
			products: term.productIds.length,
		}),
		status: term.status === 'live' ? '1' : '0',
		updated_at: term.updatedAt,
	};
}

/** Products › Search words (brief approved 2026-11-08), built like the Blog list. */
@Component({
	selector: 'app-search-term',
	templateUrl: './search-term.html',
	imports: [PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class SearchTermList {
	private router = inject(Router);
	private terms = inject(SearchTermService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);

	private readonly params = signal<Params>({});
	readonly termsQuery = injectSearchTermsQuery(() => this.params());
	private readonly table = viewChild(Table);

	/** A signal, so the table redraws when an answer arrives after it was first drawn. */
	readonly tableConfig = signal<ITableConfig<ISearchTermRow>>({
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'name', dataField: 'name' },
			{ title: 'spellings', dataField: 'spellings' },
			{ title: 'finds', dataField: 'finds' },
			{ title: 'status', dataField: 'status', type: 'switch' },
			{ title: 'updated_at', dataField: 'updated_at', type: 'date', date_format: 'dd MMM yyyy' },
		],
		rowActions: [
			{ label: 'Edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'search_term.edit' },
			{
				label: 'Delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'search_term.destroy',
			},
		],
		bulkActions: [
			{
				label: 'go_live',
				actionToPerform: 'bulk_go_live',
				icon: 'ri-rocket-line',
				permission: 'search_term.edit',
			},
			{
				label: 'take_off_shop',
				actionToPerform: 'bulk_take_down',
				icon: 'ri-eye-off-line',
				permission: 'search_term.edit',
			},
		],
		data: [],
		total: 0,
	});

	constructor() {
		effect(() => {
			const page = this.termsQuery.data();
			const translate = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
			this.tableConfig.update((config) => ({
				...config,
				data: page ? page.items.map((term) => toRow(term, translate)) : [],
				total: page ? page.total : 0,
			}));
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data);
		else if (action.actionToPerform == 'status') this.status(action.data);
		else if (action.actionToPerform == 'delete') this.delete(action.data);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data);
		else if (action.actionToPerform == 'bulk_go_live') this.bulk(action.data, 'live');
		else if (action.actionToPerform == 'bulk_take_down') this.bulk(action.data, 'draft');
	}

	edit(data: ISearchTermRow) {
		void this.router.navigateByUrl(`/search-term/edit/${data.id}`);
	}

	/** The switch: on is Go Live (refused with the gaps when something is missing), off takes the word off the shop. */
	status(data: Omit<ISearchTermRow, 'status'> & { status: number | string }) {
		this.bulk([data.id], Number(data.status) === 1 ? 'live' : 'draft');
	}

	delete(data: ISearchTermRow) {
		this.terms.remove(data.id).subscribe({
			next: () => {
				this.notifier.showSuccess(this.transloco.translate('search_word_deleted'));
				this.refresh();
			},
			error: () => this.notifier.showError(this.transloco.translate('search_word_rejected')),
		});
	}

	deleteAll(ids: string[]) {
		for (const id of ids ?? []) this.terms.remove(String(id)).subscribe({ next: () => this.refresh() });
	}

	/** One call for every ticked word. One note counts the changes; each refused word names what it lacks. */
	bulk(ids: (string | number)[], status: SearchTermStatus) {
		this.terms.setStatus((ids ?? []).map(String), status).subscribe({
			next: (result) => this.report(result, status),
			error: () => {
				this.notifier.showError(this.transloco.translate('search_word_rejected'));
				this.refresh();
			},
		});
	}

	private report(result: SearchTermStatusResult, status: SearchTermStatus) {
		const translate = (key: string) => this.transloco.translate(key);
		if (result.updated.length) {
			const key = status === 'live' ? 'search_word_bulk_live' : 'search_word_bulk_taken_down';
			this.notifier.showSuccess(this.transloco.translate(key, { count: result.updated.length }));
		}
		const names = new Map((this.tableConfig().data ?? []).map((row) => [row.id, row.name]));
		for (const { id, gaps } of result.refused) {
			this.notifier.showError(
				`${names.get(id) ?? id}: ${goLiveLabels(gaps, translate, SEARCH_TERM_GO_LIVE_WORDS).join(', ')}`,
			);
		}
		const table = this.table();
		if (table) table.selected = [];
		this.refresh();
	}

	private refresh() {
		void this.queryClient.invalidateQueries({ queryKey: ['search-terms'] });
	}
}

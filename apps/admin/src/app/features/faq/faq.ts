import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { forkJoin } from 'rxjs';

import { injectMissingLanguage, keepMissing } from '@core/i18n/missing-language';
import { Params } from '@data-access/interfaces/core.interface';
import { IFaq } from '@data-access/interfaces/faq.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectFaqsQuery } from '@data-access/queries/faq.queries';
import { FaqService } from '@data-access/services/faq.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MissingLanguageNotice } from '@shared/ui/missing-language-notice/missing-language-notice';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-faq',
	templateUrl: './faq.html',
	styleUrls: ['./faq.scss'],
	imports: [MissingLanguageNotice, PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Faq {
	router = inject(Router);

	private readonly params = signal<Params>({});
	private faqService = inject(FaqService);
	readonly faqsQuery = injectFaqsQuery(() => this.params());
	/** Opened from Settings › Languages: only items still missing one language's text. */
	readonly missing = injectMissingLanguage('faqs');

	readonly tableConfig = signal<ITableConfig>({
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'title', dataField: 'title', sortable: true, sort_direction: 'desc' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
			{ title: 'status', dataField: 'status', type: 'switch' },
		],
		rowActions: [
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'faq.edit' },
			{
				label: 'delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'faq.destroy',
			},
		],
		data: [] as IFaq[],
		total: 0,
	});

	constructor() {
		effect(() => {
			const faq = this.faqsQuery.data();
			this.tableConfig.update((config) => ({
				...config,
				// The shared table draws a switch on only for the text '1'.
				data: faq
					? keepMissing(faq.data, this.missing.ids(), (row) => String(row.faqId)).map((row) => ({
							...row,
							status: (row.status ? '1' : '0') as unknown as boolean,
						}))
					: [],
				total: faq
					? this.missing.ids()
						? keepMissing(faq.data, this.missing.ids(), (row) => String(row.faqId)).length
						: faq.total
					: 0,
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
	}

	edit(data: IFaq) {
		void this.router.navigateByUrl(`/faq/edit/${data.id}`);
	}

	/** The table hands back the switch's new value (1 on, 0 off) in `status`. */
	status(data: IFaq) {
		this.faqService
			.save({ ...data, status: Number(data.status) === 1 })
			.subscribe(() => void this.faqsQuery.refetch());
	}

	delete(data: IFaq) {
		this.faqService.remove(data.faqId).subscribe(() => void this.faqsQuery.refetch());
	}

	deleteAll(ids: number[]) {
		const rows = (this.tableConfig().data as IFaq[]).filter((row) => ids.includes(Number(row.id)));
		forkJoin(rows.map((row) => this.faqService.remove(row.faqId))).subscribe(() => void this.faqsQuery.refetch());
	}
}

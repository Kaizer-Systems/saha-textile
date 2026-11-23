import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { injectMissingLanguage, keepMissing } from '@core/i18n/missing-language';
import { IAttribute } from '@data-access/interfaces/attribute.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { injectAttributesQuery } from '@data-access/queries/attribute.queries';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { MissingLanguageNotice } from '@shared/ui/missing-language-notice/missing-language-notice';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-attribute',
	templateUrl: './attribute.html',
	styleUrls: ['./attribute.scss'],
	imports: [MissingLanguageNotice, PageWrapper, HasPermissionDirective, RouterModule, Table, TranslocoModule],
})
export class Attribute {
	router = inject(Router);
	private attributes = inject(AttributeService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);

	private readonly params = signal<Params>({});
	readonly attributesQuery = injectAttributesQuery(() => this.params());

	readonly tableConfig = signal<ITableConfig<IAttribute>>({
		columns: [
			{ title: 'No.', dataField: 'no', type: 'no' },
			{ title: 'name', dataField: 'name', sortable: true, sort_direction: 'desc' },
			{
				title: 'created_at',
				dataField: 'created_at',
				type: 'date',
				sortable: true,
				sort_direction: 'desc',
			},
		],
		rowActions: [
			{
				label: 'edit',
				actionToPerform: 'edit',
				icon: 'ri-pencil-line',
				permission: 'attribute.edit',
			},
			{
				label: 'delete',
				actionToPerform: 'delete',
				icon: 'ri-delete-bin-line',
				permission: 'attribute.destroy',
			},
		],
		data: [] as IAttribute[],
		total: 0,
	});

	/** Opened from Settings › Languages: only items still missing one language's text. */
	readonly missing = injectMissingLanguage('options');

	constructor() {
		effect(() => {
			const attribute = this.attributesQuery.data();
			this.tableConfig.update((config) => ({
				...config,
				data: attribute ? keepMissing(attribute.data, this.missing.ids(), (row) => String(row.id)) : [],
				total: attribute
					? this.missing.ids()
						? keepMissing(attribute.data, this.missing.ids(), (row) => String(row.id)).length
						: attribute.total
					: 0,
			}));
		});
	}

	onTableChange(data?: Params) {
		this.params.set({ ...data });
	}

	onActionClicked(action: ITableClickedAction) {
		if (action.actionToPerform == 'edit') this.edit(action.data as IAttribute);
		else if (action.actionToPerform == 'delete') this.delete(action.data as IAttribute);
		else if (action.actionToPerform == 'deleteAll') this.deleteAll(action.data as string[]);
	}

	edit(data: IAttribute) {
		void this.router.navigateByUrl(`/attribute/edit/${data.id}`);
	}

	delete(data: IAttribute) {
		this.attributes.deleteAttribute(data.id).subscribe({
			next: () => void this.attributesQuery.refetch(),
			error: () => this.notifier.showError(this.transloco.translate('attribute_rejected')),
		});
	}

	deleteAll(ids: string[]) {
		for (const id of ids) this.delete({ id } as IAttribute);
	}
}

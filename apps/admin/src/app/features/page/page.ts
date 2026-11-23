import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { lastValueFrom } from 'rxjs';

import { type AdminLegalPage, LegalPagesGateway } from '@core/legal-pages/legal-pages.gateway';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Table } from '@shared/ui/table/table';

/** One row of the list: the page's English title, its address and the date of the last save. */
interface PageRow {
	id: string;
	title: string;
	address: string;
	updated_at: string;
}

/**
 * Admin › Pages (Legal Pages brief, P1): the four legal pages from the API. The pencil opens a page's form. Their
 * addresses are fixed and they are always on the shop, so there is no Add Page, Delete, tick box or Status switch
 * (choice A, owner's OK 16 Nov). `?missing=<language>` (Settings › Languages) lists only pages missing that
 * language's Title or Content.
 */
@Component({
	selector: 'app-page',
	templateUrl: './page.html',
	styleUrls: ['./page.scss'],
	imports: [PageWrapper, Table, TranslocoModule],
	providers: [DatePipe],
})
export class Page {
	private readonly router = inject(Router);
	private readonly gateway = inject(LegalPagesGateway);
	readonly missing = (inject(ActivatedRoute).snapshot.queryParams['missing'] as string | undefined) ?? null;
	readonly pages = signal<AdminLegalPage[]>([]);

	readonly tableConfig = computed<ITableConfig<PageRow>>(() => {
		const rows: PageRow[] = this.pages()
			.filter((row) => !this.missing || (row.gaps[this.missing]?.length ?? 0) > 0)
			.map((row) => ({
				id: row.page.slug,
				title: row.page.title['en'] ?? row.page.slug,
				address: `/${row.page.slug}`,
				updated_at: row.page.updatedAt,
			}));
		return {
			columns: [
				{ title: 'No.', dataField: 'no', type: 'no' },
				{ title: 'title', dataField: 'title' },
				{ title: 'page_address', dataField: 'address' },
				{ title: 'updated_at', dataField: 'updated_at', type: 'date' },
			],
			rowActions: [{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'page.edit' }],
			data: rows,
			total: rows.length,
		};
	});

	constructor() {
		void lastValueFrom(this.gateway.list()).then(
			(rows) => this.pages.set(rows),
			() => this.pages.set([]),
		);
	}

	onActionClicked(action: ITableClickedAction): void {
		if (action.actionToPerform === 'edit') this.edit(action.data as PageRow);
	}

	edit(row: PageRow): void {
		void this.router.navigate(
			['/page/edit', row.id],
			this.missing ? { queryParams: { missing: this.missing } } : {},
		);
	}
}

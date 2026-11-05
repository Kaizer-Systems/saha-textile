import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2 } from 'ng-select2-component';

import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { RedirectRow, RedirectService } from '@data-access/services/redirect.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { Table } from '@shared/ui/table/table';
import { adminBreadcrumb } from '@shared/util/admin-breadcrumb';

@Component({
	selector: 'app-redirect',
	templateUrl: './redirect.html',
	imports: [PageWrapper, ReactiveFormsModule, TranslocoModule, FormFields, Table, Button, Select2, RouterLink],
})
export class Redirect {
	private api = inject(RedirectService);
	private fb = inject(FormBuilder);
	private router = inject(Router);
	readonly formOnly = signal(this.router.url.includes('/create') || this.router.url.includes('/edit/'));
	readonly crumbs = adminBreadcrumb(['catalog', this.formOnly() ? 'form' : 'redirects']);

	readonly rows = signal<RedirectRow[]>([]);
	readonly error = signal<string | null>(null);
	readonly statuses = [
		{ value: '301', label: '301' },
		{ value: '302', label: '302' },
		{ value: '410', label: '410' },
	];

	readonly form = this.fb.nonNullable.group({
		sourcePath: ['', Validators.required],
		statusCode: ['301', Validators.required],
		targetPath: [''],
		reason: ['manual', Validators.required],
	});

	readonly tableConfig: ITableConfig = {
		columns: [
			{ title: 'path', dataField: 'sourcePath', sortable: true },
			{ title: 'status', dataField: 'statusCode' },
			{ title: 'target', dataField: 'targetPath' },
			{ title: 'reason', dataField: 'reason' },
		],
		rowActions: [
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'product.edit' },
			{ label: 'delete', actionToPerform: 'delete', icon: 'ri-delete-bin-line', permission: 'product.edit' },
		],
		data: [],
		total: 0,
	};

	constructor() {
		this.reload();
	}

	reload() {
		this.api.list().subscribe({
			next: (rows) => {
				this.rows.set(rows);
				this.show(rows);
				const encoded = this.router.url.split('/edit/')[1]?.split('?')[0];
				if (!encoded) return;
				const row = rows.find((item) => item.sourcePath === decodeURIComponent(encoded));
				if (!row) return;
				this.form.patchValue({
					sourcePath: row.sourcePath,
					statusCode: String(row.statusCode),
					targetPath: row.targetPath ?? '',
					reason: row.reason,
				});
			},
			error: () => this.show([]),
		});
	}

	onTableChange(params?: Params) {
		const term = String(params?.['search'] ?? '').toLowerCase();
		const filtered = this.rows().filter((row) =>
			`${row.sourcePath} ${row.targetPath ?? ''} ${row.reason}`.toLowerCase().includes(term),
		);
		this.show(filtered);
	}

	onAction(action: ITableClickedAction) {
		const row = action.data as RedirectRow;
		if (action.actionToPerform === 'edit') this.edit(row);
		if (action.actionToPerform === 'delete') this.remove(row);
	}

	edit(row: RedirectRow) {
		void this.router.navigate(['/redirect/edit', encodeURIComponent(row.sourcePath)]);
	}

	remove(row: RedirectRow) {
		this.api.remove(row.sourcePath).subscribe({ next: () => this.reload() });
	}

	save() {
		if (this.form.invalid) return;
		const value = this.form.getRawValue();
		this.api
			.save({
				sourcePath: value.sourcePath,
				statusCode: Number(value.statusCode) === 410 ? 410 : Number(value.statusCode) === 302 ? 302 : 301,
				targetPath: Number(value.statusCode) === 410 ? undefined : value.targetPath,
				reason: value.reason,
			})
			.subscribe({
				next: () => {
					this.error.set(null);
					this.form.reset({ sourcePath: '', statusCode: '301', targetPath: '', reason: 'manual' });
					this.reload();
				},
				error: () => this.error.set('redirect_rejected'),
			});
	}

	private show(rows: RedirectRow[]) {
		this.tableConfig.data = rows;
		this.tableConfig.total = rows.length;
	}
}

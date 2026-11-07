import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { AddonTemplateRow, AddonTemplateService } from '@data-access/services/addon-template.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { Table } from '@shared/ui/table/table';

@Component({
	selector: 'app-addon-template',
	templateUrl: './addon-template.html',
	imports: [PageWrapper, ReactiveFormsModule, TranslocoModule, FormFields, Table, Button, RouterLink],
})
export class AddonTemplate {
	private api = inject(AddonTemplateService);
	private fb = inject(FormBuilder);
	private router = inject(Router);
	readonly formOnly = signal(this.router.url.includes('/create') || this.router.url.includes('/edit/'));

	readonly rows = signal<AddonTemplateRow[]>([]);

	readonly form = this.fb.nonNullable.group({
		code: ['', Validators.required],
		label: ['', Validators.required],
		priceINR: [0, Validators.required],
		unit: ['in' as 'in' | 'cm'],
		min: [0],
		max: [0],
		step: [0.5],
	});

	readonly tableConfig = signal<ITableConfig>({
		columns: [
			{ title: 'name', dataField: 'label', sortable: true },
			{ title: 'code', dataField: 'code', sortable: true },
			{ title: 'price', dataField: 'priceINR' },
		],
		rowActions: [
			{ label: 'edit', actionToPerform: 'edit', icon: 'ri-pencil-line', permission: 'product.edit' },
			{ label: 'delete', actionToPerform: 'delete', icon: 'ri-delete-bin-line', permission: 'product.edit' },
		],
		data: [],
		total: 0,
	});

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
				const row = rows.find((item) => item.code === decodeURIComponent(encoded));
				if (row) this.form.patchValue(row);
			},
			error: () => this.show([]),
		});
	}

	onTableChange(params?: Params) {
		const term = String(params?.['search'] ?? '').toLowerCase();
		this.show(this.rows().filter((row) => `${row.label} ${row.code}`.toLowerCase().includes(term)));
	}

	onAction(action: ITableClickedAction) {
		const row = action.data as AddonTemplateRow;
		if (action.actionToPerform === 'edit') this.edit(row);
		if (action.actionToPerform === 'delete') this.remove(row);
	}

	edit(row: AddonTemplateRow) {
		const base = this.router.url.includes('/addon-template') ? '/addon-template' : '/measurement';
		void this.router.navigate([base, 'edit', encodeURIComponent(row.code)]);
	}

	remove(row: AddonTemplateRow) {
		this.api.remove(row.code).subscribe({ next: () => this.reload() });
	}

	save() {
		if (this.form.invalid) return;
		const value = this.form.getRawValue();
		this.api.save({ ...value, priceINR: Number(value.priceINR) }).subscribe({
			next: () => {
				this.form.reset({ code: '', label: '', priceINR: 0, unit: 'in', min: 0, max: 0, step: 0.5 });
				this.reload();
			},
		});
	}

	private show(rows: AddonTemplateRow[]) {
		const data = rows.map((row) => ({ ...row, id: row.code }));
		this.tableConfig.update((config) => ({ ...config, data, total: rows.length }));
	}
}

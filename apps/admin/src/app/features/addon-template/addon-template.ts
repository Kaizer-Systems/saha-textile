import { Component, computed, DOCUMENT, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
	ADMIN_LOCALES,
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	SOURCE_LOCALE,
} from '@core/i18n/localized-fields';
import { Params } from '@data-access/interfaces/core.interface';
import { ITableClickedAction, ITableConfig } from '@data-access/interfaces/table.interface';
import { AddonTemplateRow, AddonTemplateService } from '@data-access/services/addon-template.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';
import { Table } from '@shared/ui/table/table';

type Measure = AddonTemplateRow['fields'][number];

const codeOf = (text: string): string =>
	text
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const number = (text: string): number | null => (text.trim() === '' ? null : Number(text));

@Component({
	selector: 'app-addon-template',
	templateUrl: './addon-template.html',
	imports: [PageWrapper, ReactiveFormsModule, TranslocoModule, FormFields, Table, Button, RouterLink, LanguageSwitch],
})
export class AddonTemplate {
	private page = inject<Document>(DOCUMENT);
	private api = inject(AddonTemplateService);
	private fb = inject(FormBuilder);
	private router = inject(Router);
	readonly formOnly = signal(this.router.url.includes('/create') || this.router.url.includes('/edit/'));

	readonly rows = signal<AddonTemplateRow[]>([]);
	readonly measures = signal<Measure[]>([]);
	readonly sizeGuide = signal<AddonTemplateRow['sizeGuide']>([]);

	readonly form = this.fb.nonNullable.group({
		code: ['', Validators.required],
		label: [''],
		priceINR: [0, Validators.required],
	});

	readonly locales = ADMIN_LOCALES;
	readonly text = new LocalizedFields(this.form, ['label']);
	private readonly nameGaps = signal<Record<string, LanguageGap[]>>({});
	/** Name plus every field label, per language, for the Language switch. */
	readonly gaps = computed(() =>
		gapsByLocale((locale) => [
			...(this.nameGaps()[locale] ?? []).map((gap) => ({ ...gap, label: 'name' })),
			...this.measures().flatMap((row, index) =>
				row.label[locale]?.trim()
					? []
					: [{ key: `field_${index}`, label: 'measurement_field', name: this.guide(row) || String(index + 1) }],
			),
		]),
	);

	readonly tableConfig = signal<ITableConfig>({
		columns: [
			{ title: 'name', dataField: 'name', sortable: true },
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

	get onSourceLanguage(): boolean {
		return this.text.locale() === SOURCE_LOCALE;
	}

	reload() {
		this.api.list().subscribe({
			next: (rows) => {
				this.rows.set(rows);
				this.show(rows);
				const encoded = this.router.url.split('/edit/')[1]?.split('?')[0];
				if (!encoded) return;
				const row = rows.find((item) => item.code === decodeURIComponent(encoded));
				if (!row) return;
				this.form.patchValue({ code: row.code, priceINR: row.priceINR });
				this.text.load({ label: row.label });
				this.measures.set(row.fields);
				this.sizeGuide.set(row.sizeGuide);
				this.refreshMissing();
			},
			error: () => this.show([]),
		});
	}

	switchLanguage(locale: string) {
		this.text.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	refreshMissing() {
		this.nameGaps.set(gapsByLocale((locale) => this.text.gaps(locale)));
	}

	guide(row: Measure): string {
		return row.label[SOURCE_LOCALE] ?? '';
	}

	/** A new field has no code until it is saved, so the guide keys it the way saving will. */
	fieldCode(row: Measure): string {
		return row.code || codeOf(this.guide(row));
	}

	addGuideRow() {
		this.sizeGuide.update((rows) => [...rows, { size: '', values: {} }]);
	}

	removeGuideRow(index: number) {
		this.sizeGuide.update((rows) => rows.filter((_, position) => position !== index));
	}

	setGuideSize(index: number, size: string) {
		this.sizeGuide.update((rows) =>
			rows.map((row, position) => (position === index ? { ...row, size: size.trim() } : row)),
		);
	}

	setGuideValue(index: number, code: string, text: string) {
		const value = number(text);
		this.sizeGuide.update((rows) =>
			rows.map((row, position) => {
				if (position !== index) return row;
				const { [code]: _old, ...others } = row.values;
				return { ...row, values: value ? { ...others, [code]: value } : others };
			}),
		);
	}

	addField() {
		this.measures.update((rows) => [...rows, { code: '', label: {}, unit: 'in', min: null, max: null, step: 0.5 }]);
	}

	removeField(index: number) {
		this.measures.update((rows) => rows.filter((_, position) => position !== index));
	}

	setLabel(index: number, row: Measure, text: string) {
		this.change(index, { label: { ...row.label, [this.text.locale()]: text } });
	}

	setUnit(index: number, unit: string) {
		this.change(index, { unit: unit === 'cm' ? 'cm' : 'in' });
	}

	setLimit(index: number, key: 'min' | 'max' | 'step', text: string) {
		this.change(index, { [key]: number(text) });
	}

	private change(index: number, part: Partial<Measure>) {
		this.measures.update((rows) => rows.map((row, position) => (position === index ? { ...row, ...part } : row)));
	}

	onTableChange(params?: Params) {
		const term = String(params?.['search'] ?? '').toLowerCase();
		this.show(
			this.rows().filter((row) => `${row.label[SOURCE_LOCALE] ?? ''} ${row.code}`.toLowerCase().includes(term)),
		);
	}

	onAction(action: ITableClickedAction) {
		const row = action.data as AddonTemplateRow;
		if (action.actionToPerform === 'edit') this.edit(row);
		if (action.actionToPerform === 'delete') this.remove(row);
	}

	private get section(): string {
		return this.router.url.includes('/addon-template') ? '/addon-template' : '/measurement';
	}

	edit(row: AddonTemplateRow) {
		void this.router.navigate([this.section, 'edit', encodeURIComponent(row.code)]);
	}

	remove(row: AddonTemplateRow) {
		this.api.remove(row.code).subscribe({ next: () => this.reload() });
	}

	save() {
		const label = this.text.text('label');
		if (!label[SOURCE_LOCALE]?.trim()) {
			this.switchLanguage(SOURCE_LOCALE);
			this.form.controls.label.setErrors({ required: true });
			return;
		}
		if (this.form.invalid) return;
		const { code, priceINR } = this.form.getRawValue();
		const fields = this.measures()
			.filter((row) => row.label[SOURCE_LOCALE]?.trim())
			.map((row) => ({ ...row, code: this.fieldCode(row) }));
		const kept = new Set(fields.map((row) => row.code));
		const sizeGuide = this.sizeGuide()
			.filter((row) => row.size)
			.map(({ size, values }) => ({
				size,
				values: Object.fromEntries(Object.entries(values).filter(([key]) => kept.has(key))),
			}));
		this.api
			.save({ code, label, priceINR: Number(priceINR), fields, sizeGuide })
			.subscribe({ next: () => void this.router.navigate([this.section]) });
	}

	private show(rows: AddonTemplateRow[]) {
		const data = rows.map((row) => ({ ...row, id: row.code, name: row.label[SOURCE_LOCALE] ?? row.code }));
		this.tableConfig.update((config) => ({ ...config, data, total: rows.length }));
	}
}

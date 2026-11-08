import { Component, DOCUMENT, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2, type Select2Data, type Select2SearchEvent } from 'ng-select2-component';
import { map, of, Subject, switchMap, takeUntil } from 'rxjs';

import {
	ADMIN_LOCALES,
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	SOURCE_LOCALE,
} from '@core/i18n/localized-fields';
import { FaqScope, IFaq } from '@data-access/interfaces/faq.interface';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { FaqService } from '@data-access/services/faq.service';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const idList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);

@Component({
	selector: 'app-form-faq',
	templateUrl: './form-faq.html',
	styleUrls: ['./form-faq.scss'],
	imports: [Select2, ReactiveFormsModule, FormFields, Button, TranslocoModule, LanguageSwitch, AdvancedDropdown],
})
export class FormFaq {
	private page = inject<Document>(DOCUMENT);
	private faqService = inject(FaqService);
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);

	readonly scopes = [
		{ value: 'global', label: 'global' },
		{ value: 'category', label: 'category' },
		{ value: 'product', label: 'product' },
		{ value: 'mixed', label: 'mixed' },
	];

	public form: FormGroup;
	public faq: IFaq | null;
	readonly fields: LocalizedFields;
	readonly locales = ADMIN_LOCALES;
	readonly gaps = signal<Record<string, LanguageGap[]>>({});

	private destroy$ = new Subject<void>();

	/** The product form's category tree picker and product search, instead of typed ids. */
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	readonly categoryOptions = computed(() => this.categoriesQuery.data()?.data ?? []);
	readonly selectedCategories = signal<string[]>([]);
	private readonly productSearch = signal('');
	private readonly productsQuery = injectCatalogProductsQuery(() => ({
		search: this.productSearch() || undefined,
		pageSize: 50,
	}));
	private readonly chosenProducts = signal<string[]>([]);
	/** Search results, plus any chosen product the results do not include, so it keeps a row. */
	readonly productOptions = computed<Select2Data>(() => {
		const rows = (this.productsQuery.data()?.items ?? []).map((row) => ({ value: row.id, label: row.title }));
		const shown = new Set(rows.map((row) => row.value));
		const kept = this.chosenProducts()
			.filter((id) => !shown.has(id))
			.map((id) => ({ value: id, label: id }));
		return [...kept, ...rows];
	});

	searchProducts(event: Select2SearchEvent) {
		this.productSearch.set(event.search ?? '');
	}

	selectCategories(ids: string[]) {
		if (!Array.isArray(ids)) return;
		this.selectedCategories.set(ids);
		this.form.controls['categoryIds'].setValue(ids);
	}

	constructor() {
		this.form = this.formBuilder.group({
			title: new FormControl(''),
			description: new FormControl(''),
			status: new FormControl(true),
			scope: new FormControl('global'),
			categoryIds: new FormControl<string[]>([]),
			productIds: new FormControl<string[]>([]),
		});
		this.fields = new LocalizedFields(this.form, ['title', 'description']);
	}

	get onSourceLanguage(): boolean {
		return this.fields.locale() === SOURCE_LOCALE;
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	refreshMissing() {
		this.gaps.set(gapsByLocale((locale) => this.fields.gaps(locale)));
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.faqService
						.getFaqs()
						.pipe(map((res) => res.data.find((faq) => faq.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((faq) => {
				this.faq = faq;
				this.form.patchValue({
					status: this.faq?.status,
					scope: this.faq?.scope ?? 'global',
					categoryIds: this.faq?.categoryIds ?? [],
					productIds: this.faq?.productIds ?? [],
				});
				this.selectedCategories.set(this.faq?.categoryIds ?? []);
				this.chosenProducts.set(this.faq?.productIds ?? []);
				this.fields.load({
					title: { en: this.faq?.title ?? '', bn: this.faq?.titleBn ?? '' },
					description: { en: this.faq?.description ?? '', bn: this.faq?.descriptionBn ?? '' },
				});
				this.refreshMissing();
			});
		this.refreshMissing();
	}

	submit() {
		this.form.markAllAsTouched();
		const title = this.fields.text('title');
		const description = this.fields.text('description');
		if (!title['en']?.trim() || !description['en']?.trim()) {
			this.switchLanguage(SOURCE_LOCALE);
			if (!title['en']?.trim()) this.form.controls['title'].setErrors({ required: true });
			if (!description['en']?.trim()) this.form.controls['description'].setErrors({ required: true });
			return;
		}
		const raw = this.form.getRawValue() as {
			status: boolean;
			scope: FaqScope;
			categoryIds: unknown;
			productIds: unknown;
		};
		this.faqService
			.save({
				...raw,
				title: title['en'],
				description: description['en'],
				titleBn: title['bn'] ?? '',
				descriptionBn: description['bn'] ?? '',
				categoryIds: idList(raw.categoryIds),
				productIds: idList(raw.productIds),
				faqId: this.faq?.faqId,
			})
			.pipe(takeUntil(this.destroy$))
			.subscribe(() => void this.router.navigateByUrl('/faq'));
	}
}

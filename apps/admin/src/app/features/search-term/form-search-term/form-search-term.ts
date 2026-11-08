import { isPlatformBrowser } from '@angular/common';
import { Component, DOCUMENT, PLATFORM_ID, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, Select2Data, Select2SearchEvent } from 'ng-select2-component';

import { SEARCH_TERM_GO_LIVE_WORDS, gapsFromError, goLiveToast } from '@core/catalog/go-live-report';
import {
	ADMIN_LOCALES,
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
} from '@core/i18n/localized-fields';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { injectSearchTermQuery } from '@data-access/queries/search-term.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { SearchTermService } from '@data-access/services/search-term.service';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const LANGUAGE_FIELDS = ['name', 'spellings'];
const SEARCH_PAUSE_MS = 300;

/** "pujo, pooja, durga puja" as a list, and back. */
export const splitSpellings = (text: string | undefined): string[] =>
	(text ?? '')
		.split(',')
		.map((word) => word.trim())
		.filter(Boolean);

/**
 * The search word form (brief approved 2026-11-08): name and spellings per language behind the one
 * Language switch, and one shared set of categories and products. Live is checked by the API, the
 * same rule as the list's Go Live.
 */
@Component({
	selector: 'app-form-search-term',
	templateUrl: './form-search-term.html',
	imports: [ReactiveFormsModule, FormFields, LanguageSwitch, AdvancedDropdown, Select2, Button, TranslocoModule],
})
export class FormSearchTerm {
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private terms = inject(SearchTermService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private page = inject<Document>(DOCUMENT);
	readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	/** The word being edited; empty on Add. */
	readonly id = input<string | undefined>(undefined);

	readonly form: FormGroup;
	readonly locales = ADMIN_LOCALES;
	readonly fields: LocalizedFields;
	readonly gaps = signal<Record<string, LanguageGap[]>>({});

	readonly termQuery = injectSearchTermQuery(() => this.id());
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	readonly categories = computed(() => this.categoriesQuery.data()?.data ?? []);
	/** The saved categories, handed to the picker once; picks after that stay inside it. */
	readonly savedCategories = signal<string[]>([]);
	readonly selectedCategories = signal<string[]>([]);

	private readonly productSearch = signal('');
	private readonly productsQuery = injectCatalogProductsQuery(() => ({
		search: this.productSearch() || undefined,
		pageSize: 50,
	}));
	/** Products already tagged, so their names show before any search. */
	private readonly tagged = signal<Select2Data>([]);
	readonly productOptions = computed<Select2Data>(() => {
		const found = (this.productsQuery.data()?.items ?? []).map((row) => ({
			label: row.title,
			value: row.id,
			data: { name: row.title, image: row.thumbnailUrl ?? 'assets/images/product.png' },
		}));
		const seen = new Set(found.map((row) => row.value));
		return [...this.tagged().filter((row) => 'value' in row && !seen.has(row.value as string)), ...found];
	});
	private searchTimer: ReturnType<typeof setTimeout> | undefined;
	private loadedId: string | null = null;

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			spellings: new FormControl(''),
			products: new FormControl<string[]>([]),
			status: new FormControl(true),
		});
		this.fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, ['spellings']);
		this.refreshMissing();

		effect(() => {
			const detail = this.termQuery.data();
			// Loaded once: a background refetch (window focus) must not wipe what is being typed.
			if (!detail || detail.term.id === this.loadedId) return;
			this.loadedId = detail.term.id;
			const { term, products } = detail;
			this.fields.load({
				name: term.name,
				spellings: Object.fromEntries(
					Object.entries(term.spellings).map(([locale, words]) => [locale, words.join(', ')]),
				),
			});
			this.savedCategories.set([...term.categoryIds]);
			this.selectedCategories.set([...term.categoryIds]);
			this.tagged.set(
				products.map((row) => ({
					label: row.name,
					value: row.id,
					data: { name: row.name, image: row.image ?? 'assets/images/product.png' },
				})),
			);
			this.form.patchValue({ status: term.status === 'live' });
			// The picker matches its value against its options, so it gets the products once they are in.
			setTimeout(() => this.form.controls['products'].setValue([...term.productIds]));
			this.refreshMissing();
		});
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	selectCategories(ids: string[]) {
		if (Array.isArray(ids)) this.selectedCategories.set(ids.map(String));
	}

	searchProducts(event: Select2SearchEvent) {
		clearTimeout(this.searchTimer);
		this.searchTimer = setTimeout(() => this.productSearch.set(event.search.trim()), SEARCH_PAUSE_MS);
	}

	submit() {
		this.form.markAllAsTouched();
		const name = this.fields.text('name');
		if (!name['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			return;
		}
		const spellings = this.fields.text('spellings');
		const raw = this.form.getRawValue() as { products: string[] | null; status: boolean };
		const body = {
			name,
			spellings: Object.fromEntries(
				Object.entries(spellings).map(([locale, text]) => [locale, splitSpellings(text)]),
			),
			categoryIds: this.selectedCategories(),
			productIds: (raw.products ?? []).map(String),
			status: raw.status ? ('live' as const) : ('draft' as const),
		};
		this.terms.save(this.id() ?? null, body).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['search-terms'] });
				void this.queryClient.invalidateQueries({ queryKey: ['search-term'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				void this.router.navigateByUrl('/search-term');
			},
			error: (error: unknown) => {
				const gaps = gapsFromError(error);
				if (!gaps.length) {
					this.notifier.showError(this.transloco.translate('search_word_rejected'));
					return;
				}
				goLiveToast(
					{ live: false, gaps },
					this.notifier,
					(key) => this.transloco.translate(key),
					SEARCH_TERM_GO_LIVE_WORDS,
				);
				const locale = gaps.find((gap) => gap.locale)?.locale;
				if (locale) this.switchLanguage(locale);
			},
		});
	}

	private refreshMissing() {
		this.gaps.set(gapsByLocale((locale) => this.fields.gaps(locale)));
	}
}

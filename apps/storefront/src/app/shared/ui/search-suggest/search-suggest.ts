import { isPlatformBrowser } from '@angular/common';
import {
	Component,
	DOCUMENT,
	DestroyRef,
	ElementRef,
	PLATFORM_ID,
	Renderer2,
	computed,
	effect,
	inject,
	input,
	output,
	signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { Subject, catchError, debounceTime, distinctUntilChanged, firstValueFrom, map, of, switchMap } from 'rxjs';

import { cardOffer } from '@core/catalog/card-offer';
import { ConsentStore } from '@core/consent/consent.store';
import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { roleSrcset } from '@core/media/resolved-image';
import {
	type SearchHistory,
	clearSearchHistory,
	forgetSearchTerm,
	readSearchHistory,
	rememberSearchProduct,
	rememberSearchTerm,
} from '@core/search/search-history';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { ProductService } from '@data-access/services/product.service';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';

import { type SuggestOption, type SuggestSection, highlight, matchCategories } from './search-suggest-options';

/** Long enough to skip the letters of a word typed quickly, short enough to feel live. */
export const SUGGEST_DEBOUNCE_MS = 200;
/** One letter matches too much to help. */
const MIN_LETTERS = 2;
const PRODUCT_ROWS = 6;

interface Answer {
	term: string;
	products: IProduct[];
	total: number;
	failed: boolean;
}

let instances = 0;

/**
 * The suggestion box under a search field (brief approved 2026-11-08). The host keeps its own
 * field and markup and hands the element in; this adds the combobox roles, the keys and the box.
 * Rendered only in the browser, positioned over the page, so it never shifts anything below.
 */
@Component({
	selector: 'app-search-suggest',
	templateUrl: './search-suggest.html',
	styleUrls: ['./search-suggest.scss'],
	imports: [TranslocoModule, CurrencySymbolPipe],
})
export class SearchSuggest {
	readonly field = input.required<HTMLInputElement>();
	readonly control = input.required<FormControl<string | null>>();
	/** Enter, "See all" or a recent search: the host opens the results page for these words. */
	readonly submitted = output<string>();
	/** Escape with the box already closed. */
	readonly escaped = output<void>();

	private readonly productService = inject(ProductService);
	private readonly consent = inject(ConsentStore);
	private readonly router = inject(Router);
	private readonly renderer = inject(Renderer2);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly page = inject<Document>(DOCUMENT);
	private readonly locale = inject(ACTIVE_LOCALE);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	readonly listId = `search-suggest-${++instances}`;
	readonly open = signal(false);
	/** The settled words: updated after each finished letter, never mid-composition. */
	readonly term = signal('');
	readonly active = signal(-1);
	private readonly answer = signal<Answer | null>(null);
	private readonly history = signal<SearchHistory>({ terms: [], products: [] });
	private readonly historyProducts = signal<IProduct[]>([]);
	private composing = false;
	private readonly typed = new Subject<string>();

	private readonly categories = injectCategoriesQuery();
	private readonly trending = injectQuery(() => ({
		queryKey: ['search-trending', this.locale],
		queryFn: () => firstValueFrom(this.productService.trending()),
		staleTime: 5 * 60 * 1000,
		enabled: this.isBrowser && this.open(),
	}));

	readonly query = computed(() => this.term().trim());
	readonly typing = computed(() => this.query().length >= MIN_LETTERS);
	/** Remembered searches show only while Functional cookies are on. */
	private readonly remembered = computed<SearchHistory>(() =>
		this.consent.allows('functional') ? this.history() : { terms: [], products: [] },
	);
	readonly noMatch = computed(() => {
		const answer = this.answer();
		return this.typing() && !!answer && !answer.failed && answer.term === this.query() && answer.total === 0;
	});
	readonly failed = computed(() => this.typing() && !!this.answer()?.failed);

	readonly sections = computed<SuggestSection[]>(() => {
		if (this.failed()) return [];
		if (this.typing() && !this.noMatch()) return this.typingSections();
		const remembered = this.remembered();
		if (!this.typing() && (remembered.terms.length || this.historyProducts().length)) {
			return [
				{
					title: 'recent_searches',
					icon: null,
					clearable: true,
					options: remembered.terms.map((term, index) => ({
						kind: 'term',
						id: this.rowId('t', index),
						term,
					})),
				},
				{
					title: 'opened_from_search',
					icon: null,
					clearable: false,
					options: this.historyProducts().map((product, index) => this.productRow(product, 'h', index)),
				},
			].filter((section) => section.options.length > 0) as SuggestSection[];
		}
		const trending = this.trending.data();
		if (!trending?.items.length) return [];
		return [
			{
				title: trending.kind === 'trending' ? 'trending_now' : 'popular_picks',
				icon: 'ri-fire-line',
				clearable: false,
				options: trending.items.map((product, index) => this.productRow(product, 'p', index)),
			},
		];
	});

	readonly options = computed(() => this.sections().flatMap((section) => section.options));
	readonly visible = computed(() => this.open() && (this.sections().length > 0 || this.noMatch() || this.failed()));
	readonly announcement = computed(() => {
		if (!this.visible()) return '';
		if (this.failed()) return 'search_unavailable';
		if (this.noMatch()) return 'search_no_match_short';
		return this.options().length ? 'search_suggestions_count' : '';
	});

	readonly highlight = highlight;
	readonly offer = cardOffer;

	constructor() {
		const destroyRef = inject(DestroyRef);

		this.typed
			.pipe(
				debounceTime(SUGGEST_DEBOUNCE_MS),
				map((value) => value.trim()),
				distinctUntilChanged(),
				// switchMap drops an older answer that lands after a newer word.
				switchMap((term) =>
					term.length < MIN_LETTERS
						? of(null)
						: this.productService.search(term, { pageSize: PRODUCT_ROWS }).pipe(
								map((page): Answer => ({
									term,
									products: page.items,
									total: page.total,
									failed: false,
								})),
								catchError(() => of<Answer>({ term, products: [], total: 0, failed: true })),
							),
				),
				takeUntilDestroyed(destroyRef),
			)
			// A short word keeps the last answer, so the list never blinks while typing on.
			.subscribe((answer) => answer && this.answer.set(answer));

		effect((onCleanup) => {
			const field = this.field();
			if (!this.isBrowser) return;
			this.renderer.setAttribute(field, 'role', 'combobox');
			this.renderer.setAttribute(field, 'aria-autocomplete', 'list');
			this.renderer.setAttribute(field, 'aria-controls', this.listId);
			this.renderer.setAttribute(field, 'autocomplete', 'off');
			const stops = [
				this.renderer.listen(field, 'focus', () => this.show()),
				this.renderer.listen(field, 'click', () => this.show()),
				this.renderer.listen(field, 'input', () => this.onInput()),
				this.renderer.listen(field, 'compositionstart', () => (this.composing = true)),
				this.renderer.listen(field, 'compositionend', () => {
					this.composing = false;
					this.onInput();
				}),
				this.renderer.listen(field, 'keydown', (event: KeyboardEvent) => this.onKeydown(event)),
				this.renderer.listen(this.page, 'pointerdown', (event: PointerEvent) => this.onOutside(event)),
			];
			// The header bar focuses its field as it opens, which can be before these listeners exist.
			if (this.page.activeElement === field) queueMicrotask(() => this.show());
			onCleanup(() => stops.forEach((stop) => stop()));
		});

		effect(() => {
			const field = this.field();
			if (!this.isBrowser) return;
			this.renderer.setAttribute(field, 'aria-expanded', String(this.visible()));
			const option = this.options()[this.active()];
			if (option) this.renderer.setAttribute(field, 'aria-activedescendant', option.id);
			else this.renderer.removeAttribute(field, 'aria-activedescendant');
		});

		// The arrow keys can reach rows below the box's fold.
		effect(() => {
			const option = this.options()[this.active()];
			if (!option || !this.isBrowser) return;
			queueMicrotask(() => this.page.getElementById(option.id)?.scrollIntoView?.({ block: 'nearest' }));
		});

		// A shorter or longer list keeps the highlight on a real row.
		effect(() => {
			if (this.active() >= this.options().length) this.active.set(-1);
		});
	}

	/** Opens the box and reads the remembered searches afresh, since another tab may have added one. */
	show(): void {
		if (!this.isBrowser) return;
		this.term.set(this.field().value);
		this.loadHistory();
		this.open.set(true);
	}

	close(): void {
		this.open.set(false);
		this.active.set(-1);
	}

	select(option: SuggestOption): void {
		switch (option.kind) {
			case 'term':
				this.control().setValue(option.term);
				this.submit(option.term);
				return;
			case 'all':
				this.submit(option.term);
				return;
			case 'category':
				this.close();
				void this.router.navigateByUrl(`/collections/${option.category.canonical_path ?? ''}`);
				return;
			case 'product':
				this.openProduct(option.product);
		}
	}

	forget(term: string, event?: Event): void {
		event?.stopPropagation();
		if (!this.isBrowser) return;
		this.history.set(forgetSearchTerm(window.localStorage, term));
	}

	clearAll(event?: Event): void {
		event?.stopPropagation();
		if (!this.isBrowser) return;
		this.history.set(clearSearchHistory(window.localStorage));
		this.historyProducts.set([]);
	}

	/** Keeps focus in the field when a row is pressed, so the keyboard stays up on phones. */
	keepFocus(event: Event): void {
		event.preventDefault();
	}

	srcset(product: IProduct): string | null {
		return roleSrcset(product.product_thumbnail?.image, 'card');
	}

	private submit(raw: string): void {
		const term = raw.replace(/\s+/g, ' ').trim();
		if (term && this.isBrowser && this.consent.allows('functional')) {
			this.history.set(rememberSearchTerm(window.localStorage, term));
		}
		this.close();
		this.field().blur();
		this.submitted.emit(term);
	}

	private openProduct(product: IProduct): void {
		const words = this.query();
		if (words) this.productService.searchClick(words, product.id);
		if (this.isBrowser && this.consent.allows('functional')) {
			if (words) rememberSearchTerm(window.localStorage, words);
			this.history.set(rememberSearchProduct(window.localStorage, product.slug));
		}
		this.close();
		this.field().blur();
		void this.router.navigate(['/product', product.slug]);
	}

	private onInput(): void {
		// A Bengali keyboard builds a letter in several steps; search once it is finished.
		if (this.composing) return;
		const value = this.field().value;
		this.term.set(value);
		this.active.set(-1);
		this.open.set(true);
		this.typed.next(value);
	}

	private onKeydown(event: KeyboardEvent): void {
		if (event.isComposing || this.composing) return;
		const count = this.options().length;
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				if (!this.open()) this.show();
				if (count) this.active.set((this.active() + 1) % count);
				return;
			case 'ArrowUp':
				event.preventDefault();
				if (count) this.active.set(this.active() <= 0 ? count - 1 : this.active() - 1);
				return;
			case 'Enter': {
				event.preventDefault();
				const option = this.visible() ? this.options()[this.active()] : undefined;
				if (option) this.select(option);
				else this.submit(this.field().value);
				return;
			}
			case 'Delete': {
				const option = this.options()[this.active()];
				if (option?.kind === 'term' && this.field().value === '') {
					event.preventDefault();
					this.forget(option.term);
				}
				return;
			}
			case 'Escape':
				if (this.visible()) {
					event.preventDefault();
					this.close();
				} else {
					this.escaped.emit();
				}
				return;
			case 'Tab':
				this.close();
		}
	}

	private onOutside(event: PointerEvent): void {
		const target = event.target as Node | null;
		if (!this.open() || !target) return;
		if (this.field().contains(target) || this.host.nativeElement.contains(target)) return;
		this.close();
	}

	private loadHistory(): void {
		const history = readSearchHistory(window.localStorage);
		this.history.set(history);
		if (!this.consent.allows('functional') || !history.products.length) {
			this.historyProducts.set([]);
			return;
		}
		const known = this.historyProducts().map((product) => product.slug);
		if (known.join() === history.products.join()) return;
		this.productService.cardsFor(history.products).subscribe({
			next: (products) => {
				const bySlug = new Map(products.map((product) => [product.slug, product]));
				this.historyProducts.set(history.products.flatMap((slug) => bySlug.get(slug) ?? []));
			},
			error: () => this.historyProducts.set([]),
		});
	}

	private typingSections(): SuggestSection[] {
		const query = this.query();
		const answer = this.answer();
		const categories = matchCategories(this.categories.data()?.data ?? [], query);
		const sections: SuggestSection[] = [];
		if (categories.length) {
			sections.push({
				title: 'categories',
				icon: null,
				clearable: false,
				options: categories.map(({ category, parent }, index) => ({
					kind: 'category',
					id: this.rowId('c', index),
					category,
					parent,
				})),
			});
		}
		if (answer?.products.length) {
			sections.push({
				title: 'products',
				icon: null,
				clearable: false,
				options: answer.products.map((product, index) => this.productRow(product, 'r', index)),
			});
			sections.push({
				title: null,
				icon: null,
				clearable: false,
				options: [{ kind: 'all', id: this.rowId('a', 0), term: query, total: answer.total }],
			});
		}
		return sections;
	}

	private productRow(product: IProduct, group: string, index: number): SuggestOption {
		return { kind: 'product', id: this.rowId(group, index), product };
	}

	private rowId(group: string, index: number): string {
		return `${this.listId}-${group}${index}`;
	}
}

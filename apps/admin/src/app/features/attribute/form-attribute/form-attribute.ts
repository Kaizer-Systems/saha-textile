import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { AdminAttributeWrite, AttributeDefinition, AttributeDefinitionTerm } from '@saha-textile/contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { ADMIN_LOCALES, LocalizedFields, SOURCE_LOCALE } from '@core/i18n/localized-fields';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const slugOf = (text: string): string =>
	text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const STYLES = ['rectangle', 'circle', 'image_swatch', 'color_swatch', 'radio', 'dropdown', 'image_tile', 'radio_bar'];
const ROLES = ['filter_only', 'variation_axis', 'named_add_on', 'bundle_component_option'];
const FACET_STYLES = ['checkbox', 'swatch', 'chips', 'radio'];

const blankTerm = (): AttributeDefinitionTerm => ({
	code: '',
	label: { en: '' },
	slug: '',
	aliases: [],
	isBase: false,
	hidden: false,
});

/** One attribute and its values. A value is one thing with a name in each language. */
@Component({
	selector: 'app-form-attribute',
	templateUrl: './form-attribute.html',
	styleUrls: ['./form-attribute.scss'],
	imports: [ReactiveFormsModule, FormFields, Button, TranslocoModule, Select2, LanguageSwitch],
})
export class FormAttribute {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private attributeService = inject(AttributeService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	readonly locales = ADMIN_LOCALES;
	readonly fields: LocalizedFields;
	readonly terms = signal<AttributeDefinitionTerm[]>([blankTerm()]);
	/** Set when editing: the code stays, because products point at it. */
	readonly code = signal<string | null>(null);

	readonly styleOptions = STYLES.map((value) => ({ value, label: value }));
	readonly roleOptions = ROLES.map((value) => ({ value, label: value }));
	readonly facetStyleOptions = FACET_STYLES.map((value) => ({ value, label: value }));

	readonly nameMissing = signal<Record<string, number>>({});
	/** Name plus every value, per language, for the Language switch. */
	readonly missing = computed(() =>
		Object.fromEntries(
			this.locales.map((locale) => [
				locale,
				(this.nameMissing()[locale] ?? 0) + this.terms().filter((term) => !term.label[locale]?.trim()).length,
			]),
		),
	);

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl(''),
			style: new FormControl('rectangle', [Validators.required]),
			default_role: new FormControl('filter_only', [Validators.required]),
			use_as_filter: new FormControl(true),
			facet_style: new FormControl('checkbox'),
		});
		this.fields = new LocalizedFields(this.form, ['name']);
	}

	get onSourceLanguage(): boolean {
		return this.fields.locale() === SOURCE_LOCALE;
	}

	get isColour(): boolean {
		return this.form.get('style')?.value === 'color_swatch';
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of(null);
					return this.attributeService
						.getDefinitions()
						.pipe(map((rows) => rows.find((row) => row.code === params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((definition) => {
				if (definition) this.load(definition);
				this.refreshMissing();
			});
	}

	private load(definition: AttributeDefinition) {
		this.code.set(definition.code);
		this.fields.load({ name: definition.label });
		this.terms.set(definition.terms);
		this.form.patchValue({
			style: definition.defaultDisplayStyle,
			default_role: definition.defaultRole,
			use_as_filter: definition.filterConfig?.visible ?? true,
			facet_style: definition.filterConfig?.defaultFacetDisplayStyle ?? 'checkbox',
		});
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	refreshMissing() {
		this.nameMissing.set(Object.fromEntries(this.locales.map((locale) => [locale, this.fields.missing(locale)])));
	}

	guide(term: AttributeDefinitionTerm): string {
		return term.label['en'] ?? '';
	}

	private change(index: number, change: Partial<AttributeDefinitionTerm>) {
		this.terms.update((rows) => rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}

	setName(index: number, term: AttributeDefinitionTerm, text: string) {
		const label = { ...term.label, [this.fields.locale()]: text };
		// A new value takes its slug from its English name; a saved one keeps it, as products use it.
		const naming = this.onSourceLanguage && !term.code;
		this.change(index, { label, ...(naming ? { slug: slugOf(text) } : {}) });
	}

	setSlug(index: number, text: string) {
		this.change(index, { slug: slugOf(text) });
	}

	setHex(index: number, hex: string) {
		this.change(index, { hex });
	}

	setAliases(index: number, text: string) {
		this.change(index, {
			aliases: text
				.split(',')
				.map((word) => word.trim())
				.filter(Boolean),
		});
	}

	toggleHidden(index: number, term: AttributeDefinitionTerm) {
		this.change(index, { hidden: !term.hidden });
	}

	add() {
		this.terms.update((rows) => [...rows, blankTerm()]);
	}

	remove(index: number) {
		this.terms.update((rows) => rows.filter((_, position) => position !== index));
	}

	submit() {
		this.form.markAllAsTouched();
		const label = this.fields.text('name');
		const english = label['en']?.trim();
		if (!english) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			return;
		}
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const terms = this.terms()
			.filter((term) => term.label['en']?.trim())
			.map((term) => {
				const slug = term.slug || slugOf(term.label['en'] as string);
				return { ...term, slug, code: term.code || slug };
			});
		const body: AdminAttributeWrite = {
			code: this.code() ?? slugOf(english),
			label: { ...label, en: english },
			defaultRole: raw['default_role'] as AdminAttributeWrite['defaultRole'],
			defaultDisplayStyle: raw['style'] as AdminAttributeWrite['defaultDisplayStyle'],
			valueType: raw['style'] === 'color_swatch' ? 'color' : 'term',
			terms,
			filterConfig: {
				visible: Boolean(raw['use_as_filter']),
				sortOrder: 0,
				defaultFacetDisplayStyle: raw['facet_style'] as 'checkbox',
			},
		};
		this.attributeService.saveAttribute(body).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['attributes'] });
				void this.router.navigateByUrl('/attribute');
			},
			error: () => this.notifier.showError(this.transloco.translate('attribute_rejected')),
		});
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}

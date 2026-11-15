import { Component, computed, DOCUMENT, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import {
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	SOURCE_LOCALE,
} from '@core/i18n/localized-fields';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import type { IAttachment } from '@data-access/interfaces/attachment.interface';
import type { AdminAttributeWrite, AttributeDefinition, AttributeDefinitionTerm } from '@saha-textile/contracts';

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
	imports: [ReactiveFormsModule, FormFields, Button, TranslocoModule, Select2, LanguageSwitch, ImageUpload],
})
export class FormAttribute {
	private page = inject<Document>(DOCUMENT);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private attributeService = inject(AttributeService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private media = inject(MediaGateway);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	readonly locales = inject(ActiveLanguages).list();
	readonly fields: LocalizedFields;
	readonly terms = signal<AttributeDefinitionTerm[]>([blankTerm()]);
	/** Each value's default picture, by image id, as the picker shows it. */
	readonly pictures = signal<ReadonlyMap<string, IAttachment>>(new Map());
	/** Set when editing: the code stays, because products point at it. */
	readonly code = signal<string | null>(null);

	readonly styleOptions = STYLES.map((value) => ({ value, label: value }));
	private readonly translations = toSignal(this.transloco.selectTranslation());
	readonly roleOptions = computed(() => {
		this.translations();
		return ROLES.map((value) => ({ value, label: this.transloco.translate(`role_name_${value}`) }));
	});
	readonly facetStyleOptions = FACET_STYLES.map((value) => ({ value, label: value }));

	readonly nameGaps = signal<Record<string, LanguageGap[]>>({});
	/** Name plus every value, per language, for the Language switch. */
	readonly gaps = computed(() =>
		gapsByLocale(this.locales, (locale) => [
			...(this.nameGaps()[locale] ?? []),
			...this.terms().flatMap((term, index) =>
				term.label[locale]?.trim()
					? []
					: [{ key: `value_${index}`, label: 'value', name: this.guide(term) || String(index + 1) }],
			),
		]),
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

	/** Picture styles give each value a default picture that products start with. */
	get isPicture(): boolean {
		const style = this.form.get('style')?.value;
		return style === 'image_swatch' || style === 'image_tile';
	}

	picture(term: AttributeDefinitionTerm): IAttachment | null {
		return term.swatchAssetId ? (this.pictures().get(term.swatchAssetId) ?? null) : null;
	}

	setPicture(index: number, picked: IAttachment | IAttachment[] | null) {
		const row = Array.isArray(picked) ? picked[0] : picked;
		if (row) this.pictures.update((map) => new Map([...map, [String(row.id), row]]));
		this.terms.update((rows) =>
			rows.map((term, position) => {
				if (position !== index) return term;
				const { swatchAssetId: _dropped, ...rest } = term;
				return row ? { ...rest, swatchAssetId: String(row.id) } : rest;
			}),
		);
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
		for (const id of new Set(definition.terms.flatMap((term) => term.swatchAssetId ?? []))) {
			this.media.get(id).subscribe({
				next: (row) => this.pictures.update((map) => new Map([...map, [id, row]])),
				error: () => undefined,
			});
		}
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

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	refreshMissing() {
		this.nameGaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
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

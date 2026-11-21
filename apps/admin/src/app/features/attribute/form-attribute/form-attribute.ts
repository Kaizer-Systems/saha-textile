import { type PickedAttachment } from '@shared/ui/image-upload/image-upload';
import { Component, computed, DOCUMENT, effect, inject, input, type Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { map, startWith, switchMap, takeUntil } from 'rxjs/operators';

import {
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	SOURCE_LOCALE,
} from '@core/i18n/localized-fields';
import { OPTION_LOOKS, usesColour, usesPicture } from '@core/catalog/option-looks';
import { SwatchPictures } from '@core/catalog/swatch-pictures';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';
import { LookPreview, type LookPreviewValue } from '@shared/ui/look-preview/look-preview';

import type { IAttachment } from '@data-access/interfaces/attachment.interface';
import type { AdminAttributeWrite, AttributeDefinition, AttributeDefinitionTerm } from '@saha-textile/contracts';

const slugOf = (text: string): string =>
	text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const ROLES = ['filter_only', 'variation_axis', 'named_add_on', 'bundle_component_option'];
const FACET_STYLES = ['checkbox', 'swatch', 'chips', 'radio'];

/** Sample colours for the preview of an attribute with no values yet. */
const SAMPLE_COLOURS = ['#1f4e96', '#b5157d', '#2e7d32'];

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
	imports: [
		ReactiveFormsModule,
		FormFields,
		Button,
		TranslocoModule,
		Select2,
		LanguageSwitch,
		ImageUpload,
		LookPreview,
	],
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
	private swatches = inject(SwatchPictures);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	readonly locales = inject(ActiveLanguages).list();
	readonly fields: LocalizedFields;
	readonly terms = signal<AttributeDefinitionTerm[]>([blankTerm()]);
	/** Each value's default picture, by image id, as the picker shows it. */
	readonly pictures = signal<ReadonlyMap<string, IAttachment>>(new Map());
	/** Set when editing: the code stays, because products point at it. */
	readonly code = signal<string | null>(null);

	readonly styleOptions = OPTION_LOOKS.map((value) => ({ value, label: value }));
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
			// A second line is optional, but once written it is owed in every language.
			...this.terms().flatMap((term, index) =>
				this.hasNote(term) && !term.subLabel?.[locale]?.trim()
					? [
							{
								key: `value_note_${index}`,
								label: 'value_second_line',
								name: this.guide(term) || String(index + 1),
							},
						]
					: [],
			),
		]),
	);

	private destroy$ = new Subject<void>();

	/** The look picked in the form, for the live preview under it (brief A5). */
	readonly look: Signal<string>;

	/**
	 * What the preview draws: the values in the language on screen with their colour and default picture (the very
	 * square the shop shows); until values are named, three samples with grey pictures.
	 */
	readonly previewValues = computed<LookPreviewValue[]>(() => {
		// Read the words again once they load, or the samples keep their key.
		this.translations();
		const locale = this.fields.locale();
		const named = this.terms().filter((term) => (term.label[locale] || term.label['en'])?.trim());
		if (!named.length) {
			return SAMPLE_COLOURS.map((hex, index) => ({
				label: this.transloco.translate('look_preview_sample', { n: index + 1 }),
				hex,
				picture: null,
			}));
		}
		return named.map((term) => ({
			label: (term.label[locale] || term.label['en']) as string,
			subLabel: term.subLabel?.[locale] || term.subLabel?.['en'] || null,
			hex: term.hex ?? null,
			picture: term.swatchAssetId
				? (this.swatches.url(term.swatchAssetId, term.swatchVersionId) ??
					this.picture(term)?.original_url ??
					null)
				: null,
		}));
	});

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl(''),
			style: new FormControl('rectangle', [Validators.required]),
			default_role: new FormControl('filter_only', [Validators.required]),
			use_as_filter: new FormControl(true),
			facet_style: new FormControl('checkbox'),
		});
		this.fields = new LocalizedFields(this.form, ['name']);
		const style = this.form.get('style') as FormControl<string>;
		this.look = toSignal(style.valueChanges.pipe(startWith(style.value)), { initialValue: style.value });
		effect(() => this.swatches.need(this.terms().flatMap((term) => term.swatchAssetId ?? [])));
	}

	get onSourceLanguage(): boolean {
		return this.fields.locale() === SOURCE_LOCALE;
	}

	get isColour(): boolean {
		return usesColour(this.form.get('style')?.value);
	}

	/** Picture styles give each value a default picture that products start with. */
	get isPicture(): boolean {
		return usesPicture(this.form.get('style')?.value);
	}

	/** True once the value's second line is written in any language. */
	hasNote(term: AttributeDefinitionTerm): boolean {
		return Object.values(term.subLabel ?? {}).some((text) => text.trim());
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
				const { swatchAssetId: _dropped, swatchVersionId: _droppedVersion, ...rest } = term;
				const versionId = (row as PickedAttachment | undefined)?.versionId;
				// The swatch keeps the version chosen in the picker (media brief: a place stores the photo and its version).
				return row
					? { ...rest, swatchAssetId: String(row.id), ...(versionId ? { swatchVersionId: versionId } : {}) }
					: rest;
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

	/** The value's optional second line in the language on screen ("Medium" under "M"); empty clears it there. */
	setNote(index: number, term: AttributeDefinitionTerm, text: string) {
		const locale = this.fields.locale();
		const { [locale]: _dropped, ...others } = term.subLabel ?? {};
		const subLabel = text.trim() ? { ...others, [locale]: text.trim() } : others;
		if (Object.keys(subLabel).length) {
			this.change(index, { subLabel });
			return;
		}
		this.terms.update((rows) =>
			rows.map((row, position) => {
				if (position !== index) return row;
				const { subLabel: _cleared, ...rest } = row;
				return rest;
			}),
		);
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
			valueType: usesColour(raw['style'] as string) ? 'color' : 'term',
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

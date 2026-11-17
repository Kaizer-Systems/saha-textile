import { Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbAccordionModule, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2, type Select2UpdateEvent } from 'ng-select2-component';

import { MediaGateway } from '@core/media/media.gateway';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { FmPicker, type FmPicked } from '@features/media/file-manager/fm-picker';

import type { IAttachment } from '@data-access/interfaces/attachment.interface';
import type { AddonTemplateRow } from '@data-access/services/addon-template.service';
import type { AttributeDefinition, ProductOptionGroup, ProductOptionTerm } from '@saha-textile/contracts';

const ROLES = ['variation_axis', 'named_add_on', 'filter_only', 'bundle_component_option'] as const;
const STYLES = ['rectangle', 'circle', 'image_swatch', 'color_swatch', 'radio', 'dropdown'] as const;

const labelIn = (label: Readonly<Record<string, string>>, locale: string): string => label[locale] ?? '';

function termFrom(term: AttributeDefinition['terms'][number], position: number): ProductOptionTerm {
	return {
		code: term.code,
		label: term.label,
		isBase: term.isBase,
		...(term.hex ? { hex: term.hex } : {}),
		...(term.swatchAssetId ? { swatchAssetId: term.swatchAssetId } : {}),
		...(term.swatchAssetId && term.swatchVersionId ? { swatchVersionId: term.swatchVersionId } : {}),
		addonTemplateIds: [],
		requiresMeasurements: false,
		sortOrder: position,
	};
}

const PLACEHOLDER = 'assets/images/product.png';

/**
 * The product's option groups. The role decides behaviour, the style only the look. A value is one
 * thing with a name in each language, so a pick here holds in every language; the picker offers
 * only values named in the language on screen, and flags a picked one that has no name there.
 */
@Component({
	selector: 'app-option-groups',
	templateUrl: './option-groups.html',
	// The Images tab's tile and badge, reused as they are for the swatch pictures.
	styleUrls: ['../product-images/product-images.scss'],
	imports: [FormsModule, TranslocoModule, NgbAccordionModule, Select2, FormFields],
})
export class OptionGroups {
	readonly groups = model.required<ProductOptionGroup[]>();
	readonly definitions = input.required<readonly AttributeDefinition[]>();
	readonly locale = input.required<string>();
	readonly templates = input<readonly AddonTemplateRow[]>([]);
	/** Attributes whose variant rows are already saved. */
	readonly savedAxes = input<readonly string[]>([]);
	/** A select keeps what was clicked, so a refused role change draws it again from the data. */
	readonly redrawing = signal(false);
	private transloco = inject(TranslocoService);
	/** One measurement template per product, asked for by any option that measures. */
	readonly templateCode = model<string | null>(null);
	/** The product's photos in Images-tab order: the tiles a swatch picture is chosen from. */
	readonly photos = input<readonly string[]>([]);
	/** Preview address of each image, shared with the Images tab. */
	readonly tiles = model<ReadonlyMap<string, string>>(new Map());

	private media = inject(MediaGateway);
	private readonly modals = inject(NgbModal);
	/** The value the media library is choosing a picture for. */
	private target: { index: number; code: string } | null = null;
	private requested = new Set<string>();

	constructor() {
		// A value brings its default picture from Settings › Attributes; fetch any preview not yet known.
		effect(() => {
			const known = this.tiles();
			const chosen = this.groups().flatMap((group) => group.terms.flatMap((term) => term.swatchAssetId ?? []));
			const missing = [...new Set(chosen)].filter((id) => !known.has(id) && !this.requested.has(id));
			for (const id of missing) {
				this.requested.add(id);
				this.media.get(id).subscribe({
					next: (row) => this.tiles.update((tiles) => new Map([...tiles, [id, row.original_url]])),
					error: () => undefined,
				});
			}
		});
	}

	readonly templateOptions = computed(() =>
		this.templates().map((row) => ({ value: row.code, label: labelIn(row.label, this.locale()) || row.code })),
	);

	private readonly translations = toSignal(this.transloco.selectTranslation());
	readonly roleOptions = computed(() => {
		this.translations();
		return ROLES.map((value) => ({ value, label: this.transloco.translate(`role_name_${value}`) }));
	});
	readonly styleOptions = STYLES.map((value) => ({ value, label: value }));
	readonly attributeOptions = computed(() =>
		this.definitions()
			.filter((row) => !this.groups().some((group) => group.attributeCode === row.code))
			.map((row) => ({ value: row.code, label: labelIn(row.label, this.locale()) || row.code })),
	);

	title(group: ProductOptionGroup): string {
		return labelIn(group.label, this.locale()) || group.attributeCode;
	}

	/** Values of a group's attribute that can be picked in this language. */
	valueOptions(group: ProductOptionGroup) {
		const definition = this.definitions().find((row) => row.code === group.attributeCode);
		return (definition?.terms ?? [])
			.filter((term) => !term.hidden && labelIn(term.label, this.locale()))
			.map((term) => ({ value: term.code, label: labelIn(term.label, this.locale()) }));
	}

	picked(group: ProductOptionGroup): string[] {
		return group.terms.map((term) => term.code);
	}

	/** Values already picked that have no name in this language. */
	unnamed(group: ProductOptionGroup): ProductOptionTerm[] {
		return group.terms.filter((term) => !labelIn(term.label, this.locale()));
	}

	baseOptions(group: ProductOptionGroup) {
		return group.terms.map((term) => ({
			value: term.code,
			label: labelIn(term.label, this.locale()) || term.code,
		}));
	}

	add(event: Select2UpdateEvent): void {
		const definition = this.definitions().find((row) => row.code === event.value);
		if (!definition) return;
		const role =
			definition.defaultRole === 'descriptive' || definition.defaultRole === 'search'
				? 'filter_only'
				: definition.defaultRole;
		const group = {
			attributeCode: definition.code,
			label: definition.label,
			semanticRole: role,
			displayStyle: definition.defaultDisplayStyle,
			requiredSelection: false,
			defaultTermCode: null,
			terms: definition.terms.slice(0, 1).map(termFrom),
		} as ProductOptionGroup;
		this.groups.update((rows) => [...rows, group]);
	}

	remove(index: number): void {
		this.groups.update((rows) => rows.filter((_, position) => position !== index));
	}

	update(index: number, change: Partial<ProductOptionGroup>): void {
		this.groups.update((rows) => rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}

	pick(index: number, group: ProductOptionGroup, event: Select2UpdateEvent): void {
		const codes = Array.isArray(event.value) ? (event.value as string[]) : [];
		const definition = this.definitions().find((row) => row.code === group.attributeCode);
		const terms = codes.flatMap((code, position) => {
			const held = group.terms.find((term) => term.code === code);
			if (held) return [held];
			const known = definition?.terms.find((term) => term.code === code);
			return known ? [termFrom(known, position)] : [];
		});
		this.update(index, { terms });
	}

	/** Leaving the axis role retires saved variant rows, so that needs a yes first. */
	setRole(index: number, group: ProductOptionGroup, semanticRole: ProductOptionGroup['semanticRole']) {
		const losesRows = group.semanticRole === 'variation_axis' && semanticRole !== 'variation_axis';
		if (losesRows && this.savedAxes().includes(group.attributeCode)) {
			if (!window.confirm(this.transloco.translate('role_change_confirm'))) {
				this.redrawing.set(true);
				setTimeout(() => this.redrawing.set(false));
				return;
			}
		}
		this.update(index, { semanticRole });
	}

	setMeasures(index: number, group: ProductOptionGroup, code: string, requiresMeasurements: boolean) {
		const terms = group.terms.map((term) => (term.code === code ? { ...term, requiresMeasurements } : term));
		this.update(index, { terms });
	}

	setOverride(index: number, group: ProductOptionGroup, code: string, value: string): void {
		const amount = value === '' ? undefined : Math.max(0, Math.round(Number(value)));
		const terms = group.terms.map((term) => {
			if (term.code !== code) return term;
			const { priceDeltaINR: _dropped, ...rest } = term;
			return amount === undefined ? rest : { ...rest, priceDeltaINR: amount };
		});
		this.update(index, { terms });
	}

	termLabel(term: ProductOptionTerm): string {
		return labelIn(term.label, this.locale()) || term.code;
	}

	/** The product's photos, then a library picture already chosen that is not one of them. */
	swatchTiles(term: ProductOptionTerm): { id: string; url: string }[] {
		const ids = [...this.photos()];
		if (term.swatchAssetId && !ids.includes(term.swatchAssetId)) ids.push(term.swatchAssetId);
		return ids.map((id) => ({ id, url: this.tiles().get(id) ?? PLACEHOLDER }));
	}

	/**
	 * Tapping a photo makes it the value's swatch; tapping the chosen one again clears it. One of the product's own
	 * photos stores no version of its own: the shop draws the version the product's gallery stores.
	 */
	chooseSwatch(index: number, group: ProductOptionGroup, code: string, assetId: string): void {
		const terms = group.terms.map((term) => {
			if (term.code !== code) return term;
			const { swatchAssetId: current, swatchVersionId: _version, ...rest } = term;
			return current === assetId ? rest : { ...rest, swatchAssetId: assetId };
		});
		this.update(index, { terms });
	}

	/** The Media picker (media step 4d): any photo, one at a time. */
	async openLibrary(index: number, code: string): Promise<void> {
		this.target = { index, code };
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start({
			title: 'fm_pick_title_swatch',
			accept: 'image',
			max: 1,
			already: 0,
			profile: null,
		});
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		const row = picked?.[0];
		if (row)
			this.fromLibrary({ id: row.assetId, original_url: row.thumbnailUrl ?? '' } as IAttachment, row.versionId);
	}

	/**
	 * A picture from the library: any image, such as a fabric close-up, or one just uploaded. It keeps the version
	 * chosen in the picker, so the swatch never silently changes version.
	 */
	fromLibrary(picked: IAttachment | IAttachment[], versionId: string | null = null): void {
		const row = Array.isArray(picked) ? picked[0] : picked;
		const target = this.target;
		const group = target ? this.groups()[target.index] : undefined;
		if (!row || !target || !group) return;
		const id = String(row.id);
		this.tiles.update((tiles) => new Map([...tiles, [id, row.original_url]]));
		const terms = group.terms.map((term) => {
			if (term.code !== target.code) return term;
			const { swatchVersionId: _version, ...rest } = term;
			return { ...rest, swatchAssetId: id, ...(versionId ? { swatchVersionId: versionId } : {}) };
		});
		this.update(target.index, { terms });
	}
}

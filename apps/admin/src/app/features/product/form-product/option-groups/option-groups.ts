import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbAccordionModule } from '@ng-bootstrap/ng-bootstrap';
import type { AttributeDefinition, ProductOptionGroup, ProductOptionTerm } from '@saha-textile/contracts';
import { Select2, type Select2UpdateEvent } from 'ng-select2-component';

import { FormFields } from '@shared/ui/form-fields/form-fields';

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
		addonTemplateIds: [],
		requiresMeasurements: false,
		sortOrder: position,
	};
}

/**
 * The product's option groups. The role decides behaviour, the style only the look. A value is one
 * thing with a name in each language, so a pick here holds in every language; the picker offers
 * only values named in the language on screen, and flags a picked one that has no name there.
 */
@Component({
	selector: 'app-option-groups',
	templateUrl: './option-groups.html',
	imports: [FormsModule, TranslocoModule, NgbAccordionModule, Select2, FormFields],
})
export class OptionGroups {
	readonly groups = model.required<ProductOptionGroup[]>();
	readonly definitions = input.required<readonly AttributeDefinition[]>();
	readonly locale = input.required<string>();

	readonly roleOptions = ROLES.map((value) => ({ value, label: value }));
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
		const role = definition.defaultRole === 'descriptive' || definition.defaultRole === 'search'
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

	setOverride(index: number, group: ProductOptionGroup, code: string, value: string): void {
		const amount = value === '' ? undefined : Math.max(0, Math.round(Number(value)));
		const terms = group.terms.map((term) => {
			if (term.code !== code) return term;
			const { priceDeltaINR: _dropped, ...rest } = term;
			return amount === undefined ? rest : { ...rest, priceDeltaINR: amount };
		});
		this.update(index, { terms });
	}
}

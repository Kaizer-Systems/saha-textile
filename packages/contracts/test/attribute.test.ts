import { describe, expect, it } from 'vitest';

import {
	AddonTemplate,
	AttributeDefaultRole,
	AttributeDefinition,
	AttributeDefinitionTerm,
	FacetDisplayStyle,
	OptionDisplayStyle,
	SemanticRole,
} from '../src/index';

describe('SemanticRole — business meaning, never display', () => {
	it('is exactly the four product-level roles', () => {
		expect(SemanticRole.options).toEqual([
			'filter_only',
			'variation_axis',
			'named_add_on',
			'bundle_component_option',
		]);
	});

	it('rejects definition-level-only roles at the product level', () => {
		expect(SemanticRole.safeParse('descriptive').success).toBe(false);
		expect(SemanticRole.safeParse('search').success).toBe(false);
	});

	it('allows the extra defaults on a global definition', () => {
		expect(AttributeDefaultRole.safeParse('descriptive').success).toBe(true);
		expect(AttributeDefaultRole.safeParse('search').success).toBe(true);
	});
});

describe('display styles are visual only', () => {
	it('carries the canonical six plus the storefront/admin parity pair', () => {
		expect(OptionDisplayStyle.options).toEqual([
			'rectangle',
			'circle',
			'image_swatch',
			'color_swatch',
			'radio',
			'dropdown',
			'image_tile',
			'radio_bar',
		]);
	});

	it('rejects an unknown renderer', () => {
		expect(OptionDisplayStyle.safeParse('image_v2').success).toBe(false);
		expect(FacetDisplayStyle.safeParse('slider').success).toBe(false);
		expect(FacetDisplayStyle.safeParse('range').success).toBe(true);
	});
});

describe('AttributeDefinitionTerm', () => {
	it('applies term defaults', () => {
		const term = AttributeDefinitionTerm.parse({
			code: 'no-stitching',
			label: { en: 'No Stitching' },
			slug: 'no-stitching',
		});
		expect(term.isBase).toBe(false);
		expect(term.aliases).toEqual([]);
	});

	it('rejects a non-hex colour and a non-slug', () => {
		const base = { code: 'black', label: { en: 'Black' }, slug: 'black' };
		expect(AttributeDefinitionTerm.safeParse({ ...base, hex: 'black' }).success).toBe(false);
		expect(AttributeDefinitionTerm.safeParse({ ...base, hex: '#000000' }).success).toBe(true);
		expect(AttributeDefinitionTerm.safeParse({ ...base, slug: 'Black Silk' }).success).toBe(false);
	});
});

describe('AttributeDefinition', () => {
	it('defaults to a non-variation-driving attribute', () => {
		const color = AttributeDefinition.parse({
			id: 'attr_color',
			code: 'color',
			label: { en: 'Color' },
		});
		// Owner lock: no axis is globally variation-driving — a product opts in per option group.
		expect(color.defaultRole).toBe('filter_only');
		expect(color.defaultDisplayStyle).toBe('rectangle');
		expect(color.valueType).toBe('term');
		expect(color.terms).toEqual([]);
	});

	it('accepts a full definition with terms and filter config', () => {
		const design = AttributeDefinition.parse({
			id: 'attr_blouse_design',
			code: 'blouse_design',
			label: { en: 'Blouse Design' },
			defaultRole: 'named_add_on',
			defaultDisplayStyle: 'image_swatch',
			terms: [
				{ code: 'no-design', label: { en: 'No Design' }, slug: 'no-design', isBase: true },
				{ code: 'design-1', label: { en: 'Design 1' }, slug: 'design-1', swatchAssetId: 'media_1' },
			],
			filterConfig: { defaultFacetDisplayStyle: 'swatch' },
		});
		expect(design.terms.find((term) => term.isBase)?.code).toBe('no-design');
		expect(design.filterConfig?.visible).toBe(true);
		expect(design.filterConfig?.sortOrder).toBe(0);
	});

	it('rejects a missing localized label and an empty code', () => {
		expect(AttributeDefinition.safeParse({ id: 'a', code: 'color', label: { bn: 'রঙ' } }).success).toBe(false);
		expect(AttributeDefinition.safeParse({ id: 'a', code: '', label: { en: 'Color' } }).success).toBe(false);
	});
});

describe('AddonTemplate — data-driven measurements, never a fixed field list', () => {
	const blouse = {
		id: 'addon_blouse_stitching',
		code: 'blouse_stitching',
		label: { en: 'Blouse Stitching' },
		fields: [{ code: 'shoulder', label: { en: 'Shoulder' }, type: 'number' as const, unit: 'in' as const }],
		appliesWhen: [{ attributeCode: 'blouse_design', termCodes: ['design-1'] }],
	};

	it('applies field and status defaults', () => {
		const template = AddonTemplate.parse(blouse);
		expect(template.status).toBe('active');
		expect(template.fields[0]?.required).toBe(false);
		expect(template.fields[0]?.type).toBe('number');
	});

	it('requires at least one field', () => {
		expect(AddonTemplate.safeParse({ ...blouse, fields: [] }).success).toBe(false);
	});

	it('requires at least one term code in a conditional visibility rule', () => {
		expect(
			AddonTemplate.safeParse({
				...blouse,
				appliesWhen: [{ attributeCode: 'blouse_design', termCodes: [] }],
			}).success,
		).toBe(false);
	});

	it('rejects an unknown measurement unit', () => {
		expect(
			AddonTemplate.safeParse({
				...blouse,
				fields: [{ code: 'shoulder', label: { en: 'Shoulder' }, unit: 'mm' }],
			}).success,
		).toBe(false);
	});
});

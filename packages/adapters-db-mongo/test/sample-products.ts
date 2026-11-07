import { Product } from '@saha-textile/contracts';

/** Sample products for the integration suite: the "No Stitching" variable-product pattern. */
interface ColorTerm {
	code: string;
	label: string;
	hex: string;
}

/**
 * Build the cartesian set of variations for a (design × color) product where
 * the first design term is the material-only "No Stitching" base.
 */
function buildVariations(
	skuBase: string,
	basePriceINR: number,
	designs: { code: string; label: string; isBase?: boolean; addINR: number }[],
	colors: ColorTerm[],
): Product['variations'] {
	const variations: Product['variations'] = [];
	for (const design of designs) {
		for (const color of colors) {
			variations.push({
				id: `${skuBase}-${design.code}-${color.code}`,
				attributes: { design: design.code, color: color.code },
				priceINR: basePriceINR + design.addINR,
				salePriceINR: null,
				sku: `${skuBase}-${design.code}-${color.code}`.toUpperCase(),
				stock: 10,
			});
		}
	}
	return variations;
}

const sareeColors: ColorTerm[] = [
	{ code: 'red', label: 'Red', hex: '#b3123c' },
	{ code: 'blue', label: 'Blue', hex: '#1e3a8a' },
];

const dmColors: ColorTerm[] = [
	{ code: 'black', label: 'Black', hex: '#000000' },
	{ code: 'green', label: 'Green', hex: '#166534' },
];

const sareeDesigns = [
	{ code: 'no-stitching', label: 'No Stitching (Blouse Piece Only)', isBase: true, addINR: 0 },
	{ code: 'design-1', label: 'Blouse Design 1', addINR: 700 },
	{ code: 'design-2', label: 'Blouse Design 2', addINR: 1000 },
];

const dmDesigns = [
	{ code: 'no-stitching', label: 'No Stitching (Material Only)', isBase: true, addINR: 0 },
	{ code: 'design-1', label: 'Salwaar Design 1', addINR: 900 },
	{ code: 'design-2', label: 'Salwaar Design 2', addINR: 1300 },
];

export const sampleProducts: Product[] = [
	Product.parse({
		id: 'prod_saree_001',
		type: 'variable',
		sku: 'SAR001',
		title: { en: 'Banarasi Pure Silk Saree' },
		slug: 'banarasi-pure-silk-saree',
		description: { en: 'Handwoven Banarasi pure silk saree with zari work.' },
		categoryIds: ['cat_pure_silk'],
		tags: ['silk', 'banarasi', 'wedding'],
		basePriceINR: 4500,
		media: { gallery: ['spaces://products/saree-001/1.webp'] },
		attributes: [
			{
				code: 'design',
				label: { en: 'Blouse' },
				usedForVariations: true,
				terms: sareeDesigns.map((d) => ({
					code: d.code,
					label: { en: d.label },
					isBase: d.isBase ?? false,
				})),
			},
			{
				code: 'color',
				label: { en: 'Color' },
				usedForVariations: true,
				terms: sareeColors.map((c) => ({ code: c.code, label: { en: c.label }, hex: c.hex })),
			},
		],
		variations: buildVariations('SAR001', 4500, sareeDesigns, sareeColors),
		status: 'live',
	}),
	Product.parse({
		id: 'prod_dm_002',
		type: 'variable',
		sku: 'DM002',
		title: { en: 'Cotton Salwaar Suit (Unstitched)' },
		slug: 'cotton-salwaar-suit-unstitched',
		description: { en: 'Unstitched cotton salwaar suit; choose a design or material only.' },
		categoryIds: ['cat_unstitched'],
		tags: ['cotton', 'salwaar', 'unstitched'],
		basePriceINR: 1200,
		media: { gallery: ['spaces://products/dm-002/1.webp'] },
		attributes: [
			{
				code: 'design',
				label: { en: 'Salwaar Designs' },
				usedForVariations: true,
				terms: dmDesigns.map((d) => ({
					code: d.code,
					label: { en: d.label },
					isBase: d.isBase ?? false,
				})),
			},
			{
				code: 'color',
				label: { en: 'Color' },
				usedForVariations: true,
				terms: dmColors.map((c) => ({ code: c.code, label: { en: c.label }, hex: c.hex })),
			},
		],
		variations: buildVariations('DM002', 1200, dmDesigns, dmColors),
		addons: [
			{ code: 'shoulder', label: { en: 'Shoulder' }, type: 'number', unit: 'in' },
			{ code: 'waist', label: { en: 'Waist' }, type: 'number', unit: 'in' },
			{ code: 'sleeve_length', label: { en: 'Sleeve Length' }, type: 'number', unit: 'in' },
		],
		status: 'live',
	}),
	Product.parse({
		id: 'prod_saree_003',
		type: 'simple',
		sku: 'SAR003',
		title: { en: 'Handloom Cotton Saree' },
		slug: 'handloom-cotton-saree',
		description: { en: 'Lightweight handloom cotton saree for daily wear.' },
		categoryIds: ['cat_cotton_sarees'],
		tags: ['cotton', 'handloom', 'daily'],
		basePriceINR: 1800,
		media: { gallery: ['spaces://products/saree-003/1.webp'] },
		status: 'live',
	}),
];

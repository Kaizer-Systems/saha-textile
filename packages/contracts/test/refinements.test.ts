import { describe, expect, it } from 'vitest';

import {
	AddonTemplateFieldWrite,
	AdminVariantWrite,
	CatalogCard,
	CatalogGallery,
	CatalogPageOptionGroup,
	CategoryPlacementSet,
	ContentBlockInput,
	CustomerIdentifier,
	FaqEntry,
	FaqWrite,
	MediaAsset,
	MediaRoleDefinition,
	ProductBundle,
	ProductMerchandisingWrite,
	ProductOptionGroup,
	RoleUpdateRequest,
	SeoRedirect,
	SeoRedirectWrite,
	isAssignmentActive,
	normalizeYouTubeVideoId,
	toSessionSummary,
	type AuthSession,
} from '../src/index';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
	result.error?.issues.map((issue) => issue.message) ?? [];

describe('AddonTemplateFieldWrite', () => {
	const option = (overrides: Record<string, unknown>) => ({
		code: 'fall',
		label: { en: 'Fall' },
		...overrides,
	});

	it('skips the range check without a range, or with an empty 0 to 0 range', () => {
		expect(AddonTemplateFieldWrite.safeParse(option({})).success).toBe(true);
		expect(AddonTemplateFieldWrite.safeParse(option({ min: 10 })).success).toBe(true);
		expect(AddonTemplateFieldWrite.safeParse(option({ max: 10 })).success).toBe(true);
		expect(AddonTemplateFieldWrite.safeParse(option({ min: 0, max: 0 })).success).toBe(true);
	});

	it('accepts a range starting at zero, with or without a step', () => {
		expect(AddonTemplateFieldWrite.safeParse(option({ min: 0, max: 10 })).success).toBe(true);
		expect(AddonTemplateFieldWrite.safeParse(option({ min: 30, max: 44, step: 0.5 })).success).toBe(true);
	});

	it('refuses a backwards range and a step that does not divide it', () => {
		expect(messages(AddonTemplateFieldWrite.safeParse(option({ min: 10, max: 10 })))).toContain(
			'min must be below max',
		);
		expect(messages(AddonTemplateFieldWrite.safeParse(option({ min: 0, max: 10, step: 3 })))).toContain(
			'the range must divide evenly by the step',
		);
	});
});

describe('CustomerIdentifier', () => {
	it('takes an email or a phone number and nothing else', () => {
		expect(CustomerIdentifier.safeParse('a@example.test').success).toBe(true);
		expect(CustomerIdentifier.safeParse('+919830012345').success).toBe(true);
		expect(CustomerIdentifier.safeParse('not-an-identifier').success).toBe(false);
	});
});

const image = (roles: Record<string, unknown[]>) => ({
	assetId: 'media_1',
	width: 300,
	height: 400,
	alt: 'Red saree',
	dominantColor: null,
	thumbHash: null,
	roles,
});
const source = { url: 'https://cdn.test/a.webp', width: 300, height: 400, format: 'image/webp' };

describe('catalogue image roles', () => {
	const card = (cardImage: unknown) => ({
		id: 'prod_1',
		slug: 'red-saree',
		title: 'Red saree',
		path: '/product/red-saree',
		price: { kind: 'range', minINR: 100, maxINR: 200 },
		badges: [],
		sku: null,
		image: cardImage,
		inStock: true,
		madeToOrder: false,
	});

	it('lets a card carry no image or the card role only', () => {
		expect(CatalogCard.safeParse(card(null)).success).toBe(true);
		expect(CatalogCard.safeParse(card(image({ card: [source] }))).success).toBe(true);
		expect(messages(CatalogCard.safeParse(card(image({ card: [source], zoom: [source] }))))).toContain(
			'a card image carries the card role only',
		);
	});

	it('needs the gallery role on a product image and allows zoom beside it', () => {
		const gallery = (frame: unknown) => ({ slug: 'red-saree', frames: [frame] });
		expect(CatalogGallery.safeParse(gallery(image({ gallery: [source], zoom: [source] }))).success).toBe(true);
		expect(messages(CatalogGallery.safeParse(gallery(image({ gallery: [] }))))).toContain(
			'a product image needs the gallery role',
		);
		expect(messages(CatalogGallery.safeParse(gallery(image({ zoom: [source] }))))).toContain(
			'a product image needs the gallery role',
		);
		expect(messages(CatalogGallery.safeParse(gallery(image({ gallery: [source], card: [source] }))))).toContain(
			'a product image carries gallery and zoom only',
		);
	});

	it('keeps swatches to the square role', () => {
		const group = (swatch: unknown) => {
			const parsed = CatalogPageOptionGroup.shape.terms.element.safeParse({
				code: 'red',
				label: 'Red',
				isBase: false,
				hex: null,
				image: swatch,
				priceDeltaINR: null,
				requiresMeasurements: false,
			});
			return parsed;
		};
		expect(group(null).success).toBe(true);
		expect(group(image({ swatch_image: [source] })).success).toBe(true);
		expect(messages(group(image({ card: [source] })))).toContain('a swatch image carries the square role only');
	});
});

describe('admin product writes', () => {
	const variant = (overrides: Record<string, unknown> = {}) => ({
		id: 'var_1',
		sku: 'SKU-1',
		mrpINR: 200,
		sellingINR: 150,
		quantity: 3,
		available: true,
		weightGrams: null,
		lengthCm: null,
		widthCm: null,
		heightCm: null,
		barcode: null,
		hsnCode: null,
		...overrides,
	});
	const product = (overrides: Record<string, unknown> = {}) => ({
		sku: 'SKU',
		status: 'live',
		featured: false,
		madeToOrder: false,
		estimatedDeliveryText: null,
		lowStockThreshold: null,
		pinnedBadges: [],
		hiddenBadges: [],
		addonPriceINR: null,
		shipping: {},
		hsnCode: null,
		variants: [variant()],
		...overrides,
	});

	it('keeps the selling price at or below the MRP', () => {
		expect(AdminVariantWrite.safeParse(variant({ mrpINR: null })).success).toBe(true);
		expect(AdminVariantWrite.safeParse(variant({ sellingINR: 200 })).success).toBe(true);
		expect(messages(AdminVariantWrite.safeParse(variant({ sellingINR: 201 })))).toContain(
			'The selling price may not be above the MRP',
		);
	});

	it('accepts an ordinary product and a made-to-order one', () => {
		expect(ProductMerchandisingWrite.safeParse(product()).success).toBe(true);
		expect(
			ProductMerchandisingWrite.safeParse(product({ madeToOrder: true, estimatedDeliveryText: '3 weeks' }))
				.success,
		).toBe(true);
	});

	it('needs made-to-order to be live and to state a lead time', () => {
		const issues = messages(
			ProductMerchandisingWrite.safeParse(product({ madeToOrder: true, status: 'disabled' })),
		);
		expect(issues).toContain('Only a live product can be made to order');
		expect(issues).toContain('Enter the lead time for a made-to-order product');
	});

	it('refuses a badge both pinned and hidden', () => {
		expect(
			messages(ProductMerchandisingWrite.safeParse(product({ pinnedBadges: ['sale'], hiddenBadges: ['sale'] }))),
		).toContain('A badge cannot be pinned and hidden');
	});

	it('refuses a repeated variant or SKU', () => {
		const repeat = 'Each variant and SKU may appear once';
		expect(
			messages(
				ProductMerchandisingWrite.safeParse(product({ variants: [variant(), variant({ sku: 'SKU-2' })] })),
			),
		).toContain(repeat);
		expect(
			messages(ProductMerchandisingWrite.safeParse(product({ variants: [variant(), variant({ id: 'var_2' })] }))),
		).toContain(repeat);
	});
});

describe('FaqWrite', () => {
	const faq = (overrides: Record<string, unknown>) => ({
		question: { en: 'Q', fr: 'Q fr' },
		answer: { en: 'A', fr: 'R fr' },
		...overrides,
	});
	const bothLanguages = 'English and French are required before publish';

	it('lets a draft go without French', () => {
		expect(FaqWrite.safeParse({ question: { en: 'Q' }, answer: { en: 'A' } }).success).toBe(true);
	});

	it('needs French in both fields before it goes live', () => {
		expect(FaqWrite.safeParse(faq({ status: 'live' })).success).toBe(true);
		expect(messages(FaqWrite.safeParse(faq({ status: 'live', question: { en: 'Q', fr: ' ' } })))).toContain(
			bothLanguages,
		);
		expect(messages(FaqWrite.safeParse(faq({ status: 'live', answer: { en: 'A' } })))).toContain(bothLanguages);
	});
});

describe('FaqEntry targets', () => {
	const entry = (overrides: Record<string, unknown>) => ({
		id: 'faq_1',
		question: { en: 'Q' },
		answer: { en: 'A' },
		scope: 'mixed',
		categoryIds: ['cat_1'],
		productIds: ['prod_1'],
		...overrides,
	});

	it('refuses categories on a product entry and repeated products', () => {
		expect(messages(FaqEntry.safeParse(entry({ scope: 'product' })))).toContain(
			'use scope `mixed` to target categories as well',
		);
		expect(messages(FaqEntry.safeParse(entry({ productIds: ['prod_1', 'prod_1'] })))).toContain(
			'duplicate product target',
		);
	});
});

describe('ContentBlockInput owners', () => {
	it('refuses an owner id on a block that has no owner', () => {
		const parsed = ContentBlockInput.safeParse({
			ownerType: 'home',
			ownerId: 'cat_1',
			position: 'hero',
			slot: 'main',
			images: { desktop: 'med_d' },
		});
		expect(messages(parsed)).toContain('a home block has no ownerId');
	});

	it('accepts a locale image set that has its phone image', () => {
		const parsed = ContentBlockInput.safeParse({
			ownerType: 'home',
			position: 'hero',
			slot: 'main',
			containsText: true,
			images: { desktop: 'd', phone: 'p' },
			localeImages: { fr: { desktop: 'fd', phone: 'fp' } },
		});
		expect(parsed.success).toBe(true);
	});
});

describe('CategoryPlacementSet', () => {
	it('accepts a root placement with no parent, and refuses one with a parent', () => {
		const root = (parentCategoryId: string | null) => ({
			id: 'plc_sarees',
			categoryId: 'cat_sarees',
			parentCategoryId,
			pathCategoryIds: ['cat_sarees'],
			pathSlugs: ['sarees'],
			pathLabel: 'Sarees',
			depth: 0,
			isCanonical: true,
		});
		expect(CategoryPlacementSet.safeParse([root(null)]).success).toBe(true);
		expect(messages(CategoryPlacementSet.safeParse([root('cat_other')]))).toContain(
			'`parentCategoryId` must match the second-to-last path entry',
		);
	});
});

describe('MediaRoleDefinition', () => {
	const role = (overrides: Record<string, unknown>) => ({
		key: 'hero_card',
		label: 'Hero card',
		purposes: ['product'],
		widths: [400, 800],
		aspect: null,
		fit: 'inside',
		...overrides,
	});

	it('keeps widths unique and needs a box for anything but inside', () => {
		expect(MediaRoleDefinition.safeParse(role({})).success).toBe(true);
		expect(MediaRoleDefinition.safeParse(role({ fit: 'cover', aspect: { width: 1, height: 1 } })).success).toBe(
			true,
		);
		expect(messages(MediaRoleDefinition.safeParse(role({ widths: [400, 400] })))).toContain(
			'role widths must be unique',
		);
		expect(messages(MediaRoleDefinition.safeParse(role({ fit: 'cover' })))).toContain(
			'`cover`, `pad` and `blur` roles need an aspect box',
		);
	});
});

describe('MediaAsset formats', () => {
	const asset = (overrides: Record<string, unknown>) => ({
		id: 'media_1',
		kind: 'video',
		originalStorageKey: 'videos/a/original.mp4',
		originalFormat: 'video/mp4',
		originalByteSize: 2_400_000,
		width: 1920,
		height: 1080,
		slug: 'festive-drape',
		...overrides,
	});

	it('takes mp4 masters only', () => {
		expect(MediaAsset.safeParse(asset({})).success).toBe(true);
		expect(messages(MediaAsset.safeParse(asset({ originalFormat: 'image/jpeg' })))).toContain(
			'video masters must be MP4 (H.264/AAC)',
		);
	});

	it('takes JPEG or PNG on an image', () => {
		expect(messages(MediaAsset.safeParse(asset({ kind: 'image' })))).toContain(
			'image assets accept JPEG or PNG uploads only',
		);
	});
});

describe('ProductBundle groups', () => {
	it('keeps group codes unique', () => {
		const group = {
			code: 'core',
			label: { en: 'Core' },
			maxSelections: 1,
			components: [{ productId: 'prod_saree_001', quantity: 1 }],
		};
		const parsed = ProductBundle.safeParse({
			id: 'bundle_1',
			productId: 'prod_set',
			bundleType: 'fixed_kit',
			pricePolicy: 'sum_components',
			groups: [group, group],
		});
		expect(messages(parsed)).toContain('bundle group codes must be unique');
	});
});

describe('ProductOptionGroup axes', () => {
	it('needs at least one term on a variation axis', () => {
		const parsed = ProductOptionGroup.safeParse({
			attributeCode: 'colour',
			label: { en: 'Colour' },
			semanticRole: 'variation_axis',
			displayStyle: 'color_swatch',
			requiredSelection: false,
			defaultTermCode: null,
			terms: [],
		});
		expect(messages(parsed)).toContain('a variation axis needs at least one term');
	});
});

describe('roles', () => {
	it('calls an assignment active until it is revoked', () => {
		expect(isAssignmentActive({ revokedAt: null })).toBe(true);
		expect(isAssignmentActive({ revokedAt: '2026-11-06T00:00:00.000Z' })).toBe(false);
	});

	it('needs at least one field in a role edit', () => {
		expect(RoleUpdateRequest.safeParse({ label: 'Editor' }).success).toBe(true);
		expect(messages(RoleUpdateRequest.safeParse({}))).toContain('at least one field must be provided');
	});
});

describe.each([
	['SeoRedirect', SeoRedirect, { id: 'red_1' }],
	['SeoRedirectWrite', SeoRedirectWrite, {}],
])('%s', (_name, schema, extra) => {
	const row = (overrides: Record<string, unknown>) => ({
		...extra,
		sourcePath: '/old',
		reason: 'legacy_woo',
		...overrides,
	});

	it('needs a target on a 301 and a 302', () => {
		expect(messages(schema.safeParse(row({ statusCode: 301 })))).toContain('a redirect needs a target path');
		expect(messages(schema.safeParse(row({ statusCode: 302 })))).toContain('a redirect needs a target path');
		expect(schema.safeParse(row({ statusCode: 301, targetPath: '/new' })).success).toBe(true);
	});

	it('refuses a target on a 410', () => {
		expect(schema.safeParse(row({ statusCode: 410 })).success).toBe(true);
		expect(messages(schema.safeParse(row({ statusCode: 410, targetPath: '/new' })))).toContain(
			'a 410 has no target',
		);
	});
});

describe('toSessionSummary', () => {
	const session = {
		id: 'ses_1',
		audience: 'storefront',
		device: { label: 'Chrome on Mac', country: 'IN', userAgentHash: 'ua-hash', ipHash: 'ip-hash' },
		createdAt: '2026-11-01T00:00:00.000Z',
		lastSeenAt: '2026-11-02T00:00:00.000Z',
		expiresAt: '2026-11-03T00:00:00.000Z',
		absoluteExpiresAt: '2026-12-01T00:00:00.000Z',
		refreshTokenHash: 'refresh-hash',
		csrfSecretHash: 'csrf-hash',
	} as unknown as AuthSession;

	it('marks the current session and carries no hashes', () => {
		const summary = toSessionSummary(session, 'ses_1');
		expect(summary).toMatchObject({ id: 'ses_1', label: 'Chrome on Mac', country: 'IN', current: true });
		expect(JSON.stringify(summary)).not.toContain('hash');
		expect(toSessionSummary(session, 'ses_2').current).toBe(false);
	});
});

describe('normalizeYouTubeVideoId', () => {
	const id = 'dQw4w9WgXcQ';

	it.each([
		[id, id],
		[`https://youtu.be/${id}`, id],
		[`https://youtu.be/${id}/extra`, id],
		[`youtube.com/watch?v=${id}`, id],
		[`https://www.youtube.com/shorts/${id}`, id],
		[`https://www.youtube.com/embed/${id}`, id],
		['https://youtu.be/', null],
		['https://www.youtube.com/shorts', null],
		['https://www.youtube.com/playlist?list=abc', null],
		['https://www.youtube.com/', null],
		['https://example.com/watch?v=dQw4w9WgXcQ', null],
		['http://[broken', null],
	])('reads %s', (input, expected) => {
		expect(normalizeYouTubeVideoId(input)).toBe(expected);
	});
});

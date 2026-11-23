import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { blogPostAssetIds } from '../src/blog';
import { BusinessWrite } from '../src/business';
import { CouponWrite } from '../src/coupon';
import { EDocKeysWrite } from '../src/edocs';
import { gstinCheckCharacter } from '../src/gst';
import { AccountStatementSearch, GstArn, PeriodGrid, VoucherListQuery } from '../src/ledger';
import { mainCategoryId } from '../src/product';
import { PurchaseEntryLineWrite, SupplierWrite } from '../src/purchasing';
import { ShopDetails, shopOnDocument, shopPan } from '../src/shop-details';
import {
	BrandApps,
	BrandSettings,
	BrandSocials,
	ProductVideos,
	StorefrontShareSettings,
	xHandleFromUrl,
} from '../src/site-settings';

const problems = (schema: z.ZodType, value: unknown): string[] => {
	const result = schema.safeParse(value);
	return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('businesses and coupons', () => {
	const business = {
		legalName: 'Boutique Ltd',
		businessType: 'privateLimited',
		kind: 'regular',
		gstin: '27AAPFU0939F1ZV',
		stateCode: '27',
		registeredAddress: { line: '1 Park Street', city: 'Kolkata', pin: '700016' },
		sellsToUs: false,
		customer: { zoneId: 'zone_retail', creditLimitINR: 200000, creditDays: 30 },
	};

	it('a registered business has a GSTIN, and one that sells to us has supplier terms', () => {
		expect(problems(BusinessWrite, { ...business, gstin: null })).toEqual(['gstin_required']);
		expect(problems(BusinessWrite, { ...business, sellsToUs: true })).toEqual(['supplier_fields_required']);
		expect(problems(BusinessWrite, { ...business, sellsToUs: true, supplier: { paymentTermsDays: 15 } })).toEqual(
			[],
		);
	});

	it('a coupon ends after it starts', () => {
		const coupon = { code: 'diwali10', title: 'Diwali', kind: 'percentOff', value: 10 };
		const validFrom = '2026-11-01T00:00:00.000Z';
		expect(problems(CouponWrite, { ...coupon, validFrom, validUntil: '2026-11-30T00:00:00.000Z' })).toEqual([]);
		expect(problems(CouponWrite, { ...coupon, validFrom, validUntil: validFrom })).toEqual(['ends_before_start']);
	});
});

describe('the books and e-documents', () => {
	it('reads one voucher kind or several, and one location or several, as a list', () => {
		const dates = { from: '2026-04-01', to: '2026-11-30' };
		expect(VoucherListQuery.parse({ ...dates, kinds: 'receipt' }).kinds).toEqual(['receipt']);
		expect(VoucherListQuery.parse({ ...dates, kinds: ['receipt', 'payment'] }).kinds).toEqual([
			'receipt',
			'payment',
		]);
		expect(AccountStatementSearch.parse({ ...dates, locationIds: 'loc_1' }).locationIds).toEqual(['loc_1']);
		expect(AccountStatementSearch.parse({ ...dates, locationIds: ['loc_1', 'loc_2'] }).locationIds).toHaveLength(2);
	});

	it('checks each GST filing on the periods grid', () => {
		expect(PeriodGrid.parse({ months: [], locks: [] }).filings).toEqual([]);
		expect(PeriodGrid.safeParse({ months: [], locks: [], filings: [{}] }).success).toBe(false);
	});

	it('writes an ARN in capitals without spaces, and refuses one of the wrong shape', () => {
		expect(GstArn.parse(' aa19 1123 0012 345 ')).toBe('AA1911230012345');
		expect(problems(GstArn, 'short')).toEqual(['arn_shape']);
	});

	it('sends e-document keys only over https', () => {
		const keys = {
			path: 'irpProvider',
			provider: 'mastersIndia',
			environment: 'sandbox',
			baseUrl: 'https://sandbox.example.com',
			userName: 'kolkata-shop',
		};
		expect(problems(EDocKeysWrite, keys)).toEqual([]);
		expect(problems(EDocKeysWrite, { ...keys, baseUrl: 'http://sandbox.example.com' })).toEqual(['https_needed']);
	});

	it('gives no GSTIN check character for a start with a character outside the alphabet', () => {
		expect(gstinCheckCharacter('19aaack1234a1z')).toBe('');
	});
});

describe('products, posts and the shop’s own details', () => {
	it('a product’s main category is its first, if any', () => {
		expect(mainCategoryId(['cat_sarees', 'cat_silk'])).toBe('cat_sarees');
		expect(mainCategoryId([])).toBeNull();
	});

	it('lists a post’s pictures once each, leaving out the empty ones', () => {
		expect(blogPostAssetIds({ coverAssetId: 'med_1', shareImageAssetId: 'med_1' })).toEqual(['med_1']);
		expect(blogPostAssetIds({ coverAssetId: null, shareImageAssetId: 'med_2' })).toEqual(['med_2']);
	});

	it('leaves out a trade name that only repeats the legal name, and reads the PAN from the GSTIN', () => {
		const details = ShopDetails.parse({
			legalName: 'K.R. Marketing',
			tradeName: 'k.r. marketing',
			city: 'Kolkata',
		});
		expect(shopOnDocument(details, 'Saha Textile').tradeName).toBe('');
		expect(shopOnDocument({ ...details, tradeName: '' }, 'Saha Textile').tradeName).toBe('');
		expect(shopOnDocument({ ...details, tradeName: 'Saha Textile' }, 'Saha Textile').tradeName).toBe(
			'Saha Textile',
		);
		expect(shopPan({ gstin: '19DBYPS6736R1ZZ' })).toBe('DBYPS6736R');
		expect(shopPan({ gstin: null })).toBeNull();
	});

	it('keeps supplier text and a bill’s own HSN when they are given', () => {
		const supplier = SupplierWrite.parse({
			legalName: 'K.R. Weavers',
			kind: 'unregistered',
			stateCode: '19',
			address: { line: '12 Bow Bazar', pin: '700012' },
			paymentTermsDays: 30,
			contactName: 'Ravi',
			email: 'ravi@example.com',
		});
		expect(supplier).toMatchObject({ contactName: 'Ravi', email: 'ravi@example.com' });
		const line = { variantId: 'v1', quantity: 2, unitPriceINR: 100, gstRatePct: 5, hsnOnBill: '5208' };
		expect(PurchaseEntryLineWrite.parse(line).hsnOnBill).toBe('5208');
	});
});

describe('brand and video settings', () => {
	it('takes only full https profile and store addresses, and an X handle from its address', () => {
		expect(problems(BrandSocials, { instagram: 'https://instagram.com/kolkata_sarees' })).toEqual([]);
		expect(problems(BrandSocials, { instagram: 'instagram.com/kolkata_sarees' })).toEqual([
			'Use a full https:// address',
		]);
		expect(xHandleFromUrl(' https://x.com/@kolkata_sarees ')).toBe('kolkata_sarees');
		expect(xHandleFromUrl('https://example.com/kolkata_sarees')).toBe('');
		expect(
			problems(BrandApps, {
				android: 'https://play.google.com/store/apps/details?id=com.example.shop',
				ios: 'https://apps.apple.com/in/app/shop/id123456789',
			}),
		).toEqual([]);
		expect(problems(BrandApps, { android: 'https://example.com/app', ios: 'https://example.com/app' })).toEqual([
			'Use the Google Play address of the app',
			'Use the App Store address of the app',
		]);
		expect(StorefrontShareSettings.parse({ xHandle: '@kolkata_sarees' }).xHandle).toBe('kolkata_sarees');
	});

	it('fills the admin logos, socials and app links with their own defaults', () => {
		const brand = BrandSettings.parse({});
		expect(brand.socials).toEqual(BrandSocials.parse({}));
		expect(brand.apps).toEqual({ android: '', ios: '' });
		expect(brand.admin).toBeDefined();
	});

	it('lists each product video once', () => {
		const video = (videoId: string) => ({
			videoId,
			title: 'Draping',
			thumbnailUrl: '',
			kind: 'video',
			durationSeconds: 60,
		});
		expect(problems(ProductVideos, [video('abcdefghijk'), video('bcdefghijkl')])).toEqual([]);
		expect(problems(ProductVideos, [video('abcdefghijk'), video('abcdefghijk')])).toEqual([
			'Each video may appear once',
		]);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchaseOrderDocument, escapeHtml, safeColour, shopLines } from '../src/purchasing/purchase-order-document';

const reads = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		readFile: ((...args: Parameters<typeof actual.readFile>) =>
			reads.fail
				? Promise.reject(new Error('asset missing'))
				: actual.readFile(...args)) as typeof actual.readFile,
	};
});

afterEach(() => {
	reads.fail = false;
	vi.unstubAllGlobals();
});

const order = (over: Record<string, unknown> = {}) =>
	({
		id: 'po_1',
		number: 'PO/26-27/000001',
		supplierName: 'Bishnupur Weavers',
		expectedBy: '2026-12-01',
		deliverTo: 'Main shop',
		noteToSupplier: null,
		createdAt: '2026-11-20T05:00:00.000Z',
		orderedValueINR: 6200,
		shopSnapshot: null,
		lines: [
			{
				sku: 'FAB-1',
				title: 'Mulmul',
				optionsLabel: '',
				supplierItemCode: null,
				soldBy: 'piece',
				quantity: 2,
				agreedPriceINR: 3100,
			},
		],
		...over,
	}) as never;

const shop = {
	legalName: '',
	tradeName: '',
	addressLines: ['1 Lake Road', ''],
	gstin: null,
	phone: null,
	email: null,
} as never;

const brandService = (storefront: () => Promise<unknown>) => ({ storefront }) as never;

describe('document helpers', () => {
	it('escapes nothing as empty, and keeps only hex theme colours', () => {
		expect(escapeHtml(null)).toBe('');
		expect(escapeHtml(undefined)).toBe('');
		expect(safeColour('#0e6b5c')).toBe('#0e6b5c');
		expect(safeColour('#abc')).toBe('#abc');
		expect(safeColour('red;}body{')).toBeNull();
		expect(safeColour(undefined)).toBeNull();
	});

	it('prints our trade name and leaves out what the shop has not typed', () => {
		const html = shopLines(
			{
				...(shop as object),
				tradeName: 'Saha Textile',
				gstin: '19AAACB1234F1Z5',
				phone: '9830000000',
				email: 'wecare@saha-textile.test',
			} as never,
			'Saha Textile Pvt Ltd',
		);
		expect(html).toBe(
			'<li><strong>Saha Textile Pvt Ltd</strong></li><li>Saha Textile</li><li>1 Lake Road</li><li>GSTIN 19AAACB1234F1Z5</li><li>9830000000</li><li>wecare@saha-textile.test</li>',
		);
	});
});

describe('purchase order document: the stylesheet and fonts', () => {
	it('reads them once per process', async () => {
		const document = new PurchaseOrderDocument();
		const first = await document.loadStatic();
		expect(first.map((asset) => asset.path)).toEqual([
			'invoice-1.css',
			'fonts/public-sans-normal-100-900-latin.woff2',
			'fonts/public-sans-normal-100-900-latin-ext.woff2',
			'fonts/noto-sans-bengali-normal-400-600-bengali.woff2',
		]);
		expect(await document.loadStatic()).toBe(first);
	});

	it('forgets a failed read so the next document tries again', async () => {
		const document = new PurchaseOrderDocument();
		reads.fail = true;
		await expect(document.loadStatic()).rejects.toThrow('asset missing');
		reads.fail = false;
		expect(await document.loadStatic()).toHaveLength(4);
	});
});

describe('purchase order document: the brand', () => {
	it('falls back to the shop name and no logo without a Brand Kit, or when it fails', async () => {
		expect(await new PurchaseOrderDocument().brandFacts()).toEqual({ shopName: 'Saha Textile', logoUrl: null });
		const failing = new PurchaseOrderDocument(brandService(async () => Promise.reject(new Error('down'))));
		expect(await failing.brandFacts()).toEqual({ shopName: 'Saha Textile', logoUrl: null });
		expect(await failing.logo()).toEqual({ asset: null, shopName: 'Saha Textile', themeColor: null });
		const named = new PurchaseOrderDocument(
			brandService(async () => ({
				shopName: 'Saha Textile Kolkata',
				logo: { url: 'https://cdn.test/logo.webp' },
			})),
		);
		expect(await named.brandFacts()).toEqual({
			shopName: 'Saha Textile Kolkata',
			logoUrl: 'https://cdn.test/logo.webp',
		});
	});

	it('fetches the logo, typed or as webp, preferring the admin theme colour', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }),
		);
		vi.stubGlobal('fetch', fetch);
		const document = new PurchaseOrderDocument(
			brandService(async () => ({
				shopName: '',
				logo: { url: 'https://cdn.test/logo.png' },
				adminThemeColor: '#123456',
				themeColor: '#abcdef',
			})),
		);
		const logo = await document.logo();
		expect(logo).toMatchObject({ shopName: 'Saha Textile', themeColor: '#123456' });
		expect(logo.asset).toMatchObject({ path: 'logo', contentType: 'image/png' });
		vi.stubGlobal('fetch', async () => {
			const response = new Response(new Uint8Array([1]), { status: 200 });
			response.headers.delete('content-type');
			return response;
		});
		const untyped = new PurchaseOrderDocument(
			brandService(async () => ({
				shopName: 'S',
				logo: { url: 'https://cdn.test/logo' },
				themeColor: '#abcdef',
			})),
		);
		const plain = await untyped.logo();
		expect(plain.asset?.contentType).toBe('image/webp');
		expect(plain.themeColor).toBe('#abcdef');
	});

	it('prints the name instead when the logo answers an error or is not an image', async () => {
		const document = new PurchaseOrderDocument(
			brandService(async () => ({ shopName: 'S', logo: { url: 'https://cdn.test/logo.png' } })),
		);
		vi.stubGlobal('fetch', async () => new Response('gone', { status: 404 }));
		expect((await document.logo()).asset).toBeNull();
		vi.stubGlobal(
			'fetch',
			async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
		);
		expect((await document.logo()).asset).toBeNull();
	});
});

describe('purchase order document: the page and the PDF request', () => {
	it('prints the supplier’s GSTIN, email and phone, codes, metres, a note, the logo and the colour', () => {
		const html = new PurchaseOrderDocument().html(
			order({
				noteToSupplier: 'Pack each <saree> alone',
				lines: [
					{
						sku: 'FAB-1',
						title: 'Mulmul',
						optionsLabel: 'white',
						supplierItemCode: 'MM-9',
						soldBy: 'metre',
						quantity: 25,
						agreedPriceINR: 310,
					},
				],
			}),
			{ gstin: '19AAACB1234F1Z5', email: 'orders@bishnupur.test', phone: '9830000000' } as never,
			shop,
			{ hasLogo: true, shopName: 'Saha Textile', themeColor: '#0e6b5c' },
		);
		expect(html).toContain('GSTIN : <span class="text-content">19AAACB1234F1Z5</span>');
		expect(html).toContain('Email : <span class="text-content">orders@bishnupur.test</span>');
		expect(html).toContain('Phone : <span class="text-content">9830000000</span>');
		expect(html).toContain('FAB-1 · your code MM-9 · by the metre');
		expect(html).toContain(' / m</td>');
		expect(html).toContain('<img src="logo" alt="Saha Textile">');
		expect(html).toContain('<style>:root{--theme-color:#0e6b5c}</style>');
		expect(html).toContain('Note: Pack each &lt;saree&gt; alone ');
		expect(html).toContain('<h5>For Saha Textile</h5>');
	});

	it('renders a draft with today’s details and the logo, and a sent order with the ones it went out with', async () => {
		vi.stubGlobal(
			'fetch',
			async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/webp' } }),
		);
		const document = new PurchaseOrderDocument(
			brandService(async () => ({ shopName: 'Saha Textile', logo: { url: 'https://cdn.test/logo.webp' } })),
		);
		const draft = await document.render(order(), null, { legalName: '', gstin: null, address: 'Kolkata' } as never);
		expect(draft.assets.map((asset) => asset.path)).toContain('logo');
		expect(draft).toMatchObject({ title: 'Purchase order PO/26-27/000001', author: 'Saha Textile' });
		const sent = await new PurchaseOrderDocument().render(
			order({ shopSnapshot: { ...(shop as object), legalName: 'Saha Textile Pvt Ltd' } }),
			null,
			{ legalName: 'Today', gstin: null, address: '' } as never,
		);
		expect(sent.author).toBe('Saha Textile Pvt Ltd');
		expect(sent.assets).toHaveLength(4);
		expect(sent.html).toContain('<span class="shop-name">Saha Textile</span>');
		// A snapshot without a legal name: the Brand Kit's name signs the PDF.
		const unnamed = await new PurchaseOrderDocument().render(order({ shopSnapshot: shop }), null, {} as never);
		expect(unnamed.author).toBe('Saha Textile');
	});
});

import { expect, test, type Page } from '@playwright/test';

import { withDatabase } from './database';
import { ADMIN } from './support';

test.skip(!process.env['E2E_ADMIN_EMAIL'], 'needs `pnpm e2e:stack`');

async function open(page: Page, path: string): Promise<void> {
	await page.goto(`${ADMIN}${path}`);
	await page.waitForLoadState('networkidle');
}

test.describe('Admin shell', () => {
	test('the sidebar labels are real words and the title names the shop', async ({ page }) => {
		await open(page, '/dashboard');
		await expect(page).toHaveTitle(/Saha Textile/);
		const sidebar = page.locator('.sidebar-wrapper, .page-sidebar').first();
		await sidebar.getByText('Products', { exact: true }).click();
		await expect(sidebar.getByText('Measurements', { exact: true })).toBeVisible();
		await expect(sidebar.getByText('Add-on Templates', { exact: true })).toBeVisible();
	});

	test('a child row loses its highlight after leaving it', async ({ page }) => {
		await open(page, '/product');
		const sidebar = page.locator('.sidebar-wrapper, .page-sidebar').first();
		const child = sidebar.locator('a', { hasText: 'All Products' }).first();
		await expect(child).toHaveClass(/active/);
		await sidebar.getByText('Dashboard', { exact: true }).click();
		await expect(page).toHaveURL(/\/dashboard/);
		await expect(child).not.toHaveClass(/active/);
	});
});

test.describe('Screens backed by the API', () => {
	const screens: Array<[string, string]> = [
		['/product', 'Handwoven Katan Banarasi Saree'],
		['/admin-user', 'e2e-admin@example.test'],
		['/role', 'Administrator'],
		['/customer', 'example.com'],
		['/redirect', 'Redirects'],
		['/faq', 'FAQ'],
		['/qna', 'Q&A'],
		['/addon-template', 'Add-on'],
		['/media', 'Media'],
		['/review', 'Review'],
		['/setting/notifications', 'Notification'],
		['/home-banners', 'Banner'],
	];
	for (const [path, text] of screens) {
		test(`${path} loads`, async ({ page }) => {
			const failures: string[] = [];
			page.on('response', (response) => {
				if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
			});
			page.on('pageerror', (error) => failures.push(error.message));
			await open(page, path);
			await expect(page.locator('body')).toContainText(text, { ignoreCase: true });
			expect(failures).toEqual([]);
		});
	}
});

test.describe('Saved through the API', () => {
	test('a product edit reaches the database and survives a reload', async ({ page }) => {
		await open(page, '/product/edit/prd_906');
		await page.locator('.nav-link', { hasText: 'Inventory' }).click();
		const threshold = page.locator('#low_stock_threshold');
		await threshold.fill('7');
		await page.getByRole('button', { name: /update product/i }).click();
		await expect(page).toHaveURL(/\/product$/);

		await open(page, '/product/edit/prd_906');
		await page.locator('.nav-link', { hasText: 'Inventory' }).click();
		await expect(threshold).toHaveValue('7');
		const saved = await withDatabase((db) => db.collection('products').findOne({ _id: 'prd_906' as never }));
		expect(saved?.['lowStockThreshold']).toBe(7);
	});

	test('a redirect is created, listed, and answers on the shop', async ({ page, request }) => {
		test.setTimeout(100_000);
		const path = `/e2e-old-page-${Date.now()}`;
		await open(page, '/redirect/create');
		await page.locator('#sourcePath').fill(path);
		await page.locator('#targetPath').fill('/en/about-us');
		await page.locator('#save-redirect button, button#save-redirect').first().click();
		await expect(page).toHaveURL(/\/redirect$/);
		const saved = await withDatabase((db) => db.collection('seoRedirects').findOne({ sourcePath: path }));
		expect(saved?.['targetPath']).toBe('/en/about-us');

		// The shop refreshes its copy of the rows on a short timer, so a save shows up on the next one.
		const status = async () => (await request.get(`https://localhost:4200${path}`, { maxRedirects: 0 })).status();
		await expect.poll(status, { timeout: 70_000, intervals: [1_000] }).toBe(301);
		const answer = await request.get(`https://localhost:4200${path}`, { maxRedirects: 0 });
		expect(answer.headers()['location']).toContain('/en/about-us');
	});

	test('an answer to a product question reaches the product page', async ({ page }) => {
		const id = `q_e2e_${Date.now()}`;
		await withDatabase((db) =>
			db.collection('productQuestions').insertOne({
				_id: id as never,
				productId: 'prd_906',
				question: 'Does this come with a blouse piece?',
				askerName: 'Priya',
				answer: 'Yes, an unstitched blouse piece is included.',
				status: 'answered',
				createdAt: new Date(),
				updatedAt: new Date(),
			}),
		);
		await page.goto('https://localhost:4200/en/product/banarasi-silk-saree-color');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('body')).toContainText('Does this come with a blouse piece?');
		await expect(page.locator('body')).toContainText('an unstitched blouse piece is included');
	});
});

test.describe('Product builder', () => {
	const sku = `E2E-${Date.now()}`;
	const tab = (page: Page, name: string) => page.locator('.nav-link', { hasText: name }).first();
	const language = (page: Page, name: string) => page.locator('app-language-switch button', { hasText: name });
	const stored = () => withDatabase((db) => db.collection('products').findOne({ sku }));

	test.describe.configure({ mode: 'serial' });

	test('adds a product, which starts disabled', async ({ page }) => {
		await open(page, '/product/create');
		await page.locator('#name').fill('Builder Test Saree');
		await page.locator('#sort_description').fill('A short description.');
		await tab(page, 'Inventory').click();
		await page.locator('#sku').fill(sku);
		await page.locator('#quantity').fill('7');
		await page.locator('#price').fill('4500');
		await page.getByRole('button', { name: /save product/i }).click();
		await expect(page).toHaveURL(/\/product$/);
		expect(await stored()).toMatchObject({
			status: 'disabled',
			slug: 'builder-test-saree',
			shortDescription: { en: 'A short description.' },
		});
		const row = await withDatabase(async (db) =>
			db.collection('productVariants').findOne({ productId: (await stored())?._id as never }),
		);
		expect(row).toMatchObject({ priceINR: 4500, stock: { quantity: 7 } });
	});

	test('Go Live refuses and lists every gap, in the toast and on the form', async ({ page }) => {
		const product = await stored();
		await open(page, `/product/edit/${String(product?._id)}`);
		await tab(page, 'Status').click();
		await page.locator('#go_live_btn').click();
		await expect(page.locator('.alert-danger')).toContainText('Français: Name');
		await expect(page.locator('.alert-danger')).toContainText('Choose at least one category');
		await page.locator('.alert-danger a', { hasText: 'Meta title' }).first().click();
		await expect(page.locator('#meta_title')).toBeVisible();
		expect((await stored())?.['status']).toBe('disabled');
	});

	test('one Language switch changes every language field, and the form saves them', async ({ page }) => {
		const product = await stored();
		await open(page, `/product/edit/${String(product?._id)}`);
		await expect(page.locator('#name')).toHaveValue('Builder Test Saree');
		await language(page, 'Français').click();
		await expect(page.locator('#name')).toHaveValue('');
		await expect(page.locator('body')).toContainText('Builder Test Saree');
		await page.locator('#name').fill('Saree de test');
		await page.locator('#sort_description').fill('Une description courte.');
		await language(page, 'English').click();
		await expect(page.locator('#name')).toHaveValue('Builder Test Saree');
		await language(page, 'Français').click();
		await expect(page.locator('#name')).toHaveValue('Saree de test');
		await page.getByRole('button', { name: /update product/i }).click();
		await expect(page).toHaveURL(/\/product$/);
		expect(await stored()).toMatchObject({
			title: { en: 'Builder Test Saree', fr: 'Saree de test' },
			shortDescription: { fr: 'Une description courte.' },
		});
	});

	test('the list action uses the same check, and a finished product goes live', async ({ page, request }) => {
		await open(page, '/product');
		await withDatabase(async (db) => {
			const asset = await db.collection('mediaAssets').findOne({});
			const [first] = asset?.['derivatives'] as Record<string, unknown>[];
			await db
				.collection('mediaAssets')
				.updateOne({ _id: asset?._id }, { $push: { derivatives: { ...first, role: 'thumb' } } as never });
			await db.collection('products').updateOne(
				{ sku },
				{
					$set: {
						description: { en: 'Long', fr: 'Long' },
						seo: { title: { en: 'T', fr: 'T' }, description: { en: 'D', fr: 'D' } },
						categoryIds: ['cat_1'],
						'media.gallery': [asset?._id],
						'media.altOverrides': { [String(asset?._id)]: { en: 'Alt', fr: 'Alt' } },
					},
				},
			);
		});
		await page.reload();
		await page.waitForLoadState('networkidle');
		await page.locator('app-table input').first().fill(sku);
		const row = page.locator('tr', { hasText: sku });
		await expect(row).toBeVisible();
		await row.locator('.ri-rocket-line').click();
		await expect
			.poll(async () => (await stored())?.['status'])
			.toBe('live');
		const french = await request.get('https://localhost:4200/fr/product/builder-test-saree');
		expect(await french.text()).toContain('Saree de test');
	});
});

test.describe('Categories and attributes', () => {
	test('a category saves through the API, and a rename forwards the old address', async ({ page }) => {
		const slug = `e2e-cat-${Date.now()}`;
		await open(page, '/category');
		await page.locator('input[formcontrolname="name"]').fill('E2E Category');
		await page.locator('#slug').fill(slug);
		await page.locator('#category_btn button, button#category_btn').first().click();
		await expect
			.poll(() => withDatabase((db) => db.collection('categories').countDocuments({ slug })))
			.toBe(1);
		const row = await withDatabase((db) => db.collection('categories').findOne({ slug }));
		await open(page, `/category/edit/${String(row?._id)}`);
		await expect(page.locator('#slug')).toHaveValue(slug);
		await page.locator('#slug').fill(`${slug}-new`);
		await page.locator('#category_btn button, button#category_btn').first().click();
		await expect
			.poll(() =>
				withDatabase((db) => db.collection('seoRedirects').countDocuments({ sourcePath: `/collections/${slug}` })),
			)
			.toBe(1);
	});

	test('an attribute saves with its values in both languages', async ({ page }) => {
		const name = `E2E Attribute ${Date.now()}`;
		await open(page, '/attribute/create');
		await page.locator('#name').fill(name);
		await page.locator('#value_0').fill('Red');
		await page.locator('#value_0').blur();
		await page.locator('app-language-switch button', { hasText: 'Français' }).click();
		// The value box redraws for the new language; typing before that would be wiped.
		await expect(page.locator('#value_0')).toHaveValue('');
		await page.locator('#name').fill('Attribut');
		await page.locator('#value_0').fill('Rouge');
		await page.locator('#value_0').blur();
		await page.locator('#attribute_btn button, button#attribute_btn').first().click();
		await expect(page).toHaveURL(/\/attribute$/);
		const saved = await withDatabase((db) => db.collection('attributeDefinitions').findOne({ 'label.en': name }));
		expect(saved).toMatchObject({ label: { fr: 'Attribut' }, terms: [{ label: { en: 'Red', fr: 'Rouge' } }] });
	});
});

test.describe('What admin makes reaches the shop', () => {
	const shop = 'https://localhost:4200';

	test('a category named in both languages joins the shop menu, in each language', async ({ page, request }) => {
		const slug = `e2e-menu-${Date.now()}`;
		await open(page, '/category');
		await page.locator('input[formcontrolname="name"]').fill('Menu Category');
		await page.locator('#slug').fill(slug);
		await page.locator('app-language-switch button', { hasText: 'Français' }).click();
		await expect(page.locator('input[formcontrolname="name"]')).toHaveValue('');
		await page.locator('input[formcontrolname="name"]').fill('Catégorie du menu');
		await page.locator('#category_btn button, button#category_btn').first().click();
		await expect
			.poll(() => withDatabase((db) => db.collection('categories').countDocuments({ slug })))
			.toBe(1);
		try {
			await expect.poll(async () => (await request.get(`${shop}/fr`)).text()).toContain('Catégorie du menu');
			expect(await (await request.get(`${shop}/en`)).text()).toContain('Menu Category');
			expect(await (await request.get(`${shop}/fr`)).text()).toContain(`/collections/${slug}`);
		} finally {
			await withDatabase(async (db) => {
				await db.collection('categories').deleteMany({ slug });
				await db.collection('categoryPlacements').deleteMany({ pathKey: slug });
			});
		}
	});

	test('a category missing a language stays out of the shop', async ({ page, request }) => {
		const slug = `e2e-half-${Date.now()}`;
		await open(page, '/category');
		await page.locator('input[formcontrolname="name"]').fill('English Only Category');
		await page.locator('#slug').fill(slug);
		await page.locator('#category_btn button, button#category_btn').first().click();
		await expect
			.poll(() => withDatabase((db) => db.collection('categories').countDocuments({ slug })))
			.toBe(1);
		try {
			expect(await (await request.get(`${shop}/en`)).text()).not.toContain('English Only Category');
		} finally {
			await withDatabase(async (db) => {
				await db.collection('categories').deleteMany({ slug });
				await db.collection('categoryPlacements').deleteMany({ pathKey: slug });
			});
		}
	});

	test('a measurement template works from admin through to the shop price', async ({ page, request }) => {
		const code = `e2e-fit-${Date.now()}`;
		const slug = 'dhakai-jamdani-saree-with-blouse';
		const original = await withDatabase((db) => db.collection('products').findOne({ slug }));
		await open(page, '/measurement/create');
		await page.locator('#label').fill('Fitted Blouse');
		await page.locator('#code').fill(code);
		await page.locator('#priceINR').fill('777');
		await page.locator('#add_field_btn').click();
		await page.locator('#field_0').fill('Bust');
		await page.locator('#field_0').blur();
		await page.locator('#add_field_btn').click();
		await page.locator('#field_1').fill('Upper Arm');
		await page.locator('#field_1').blur();
		await page.locator('app-language-switch button', { hasText: 'Français' }).click();
		await expect(page.locator('#label')).toHaveValue('');
		await expect(page.locator('#field_0')).toHaveValue('');
		await expect(page.locator('#field_1')).toHaveValue('');
		await page.locator('#label').fill('Blouse ajustée');
		await page.locator('#field_0').fill('Poitrine');
		await page.locator('#field_0').blur();
		await page.locator('#field_1').fill('Haut du bras');
		await page.locator('#field_1').blur();
		await page.locator('#save-addon button, button#save-addon').first().click();
		await expect(page).toHaveURL(/\/measurement$/);
		const template = await withDatabase((db) => db.collection('addonTemplates').findOne({ code }));
		expect(template).toMatchObject({
			label: { en: 'Fitted Blouse', fr: 'Blouse ajustée' },
			fields: [{ code: 'bust', label: { fr: 'Poitrine' } }, { code: 'upper-arm' }],
		});
		try {
			await open(page, `/product/edit/${String(original?._id)}`);
			await page.locator('.nav-link', { hasText: 'Inventory' }).first().click();
			await page.locator('#template_0 .select2-selection').click();
			await page.locator('.select2-results__option', { hasText: 'Fitted Blouse' }).click();
			await expect(page.locator('#measures_0_standard')).toBeChecked();
			const standard = page.locator('.input-group', { has: page.locator('#measures_0_standard') });
			await standard.locator('input[type="number"]').fill('');
			await standard.locator('input[type="number"]').blur();
			await page.getByRole('button', { name: /update product/i }).click();
			await expect(page).toHaveURL(/\/product$/);
			const saved = await withDatabase((db) => db.collection('products').findOne({ slug }));
			expect(saved).toMatchObject({ addonTemplateCode: code, status: 'live' });
			const french = await request.get(`https://localhost:4000/catalog/products/${slug}/view?locale=fr`);
			expect(french.status(), await french.text()).toBe(200);
			const body = (await french.json()) as {
				measurements: { fields: { label: string }[] };
				optionGroups: { code: string; terms: { code: string; priceDeltaINR: number | null }[] }[];
			};
			expect(body.measurements.fields.map((row) => row.label)).toEqual(['Poitrine', 'Haut du bras']);
			const stitch = body.optionGroups.find((group) => group.code === 'blouse-stitch');
			expect(stitch?.terms.find((term) => term.code === 'standard')?.priceDeltaINR).toBe(777);
		} finally {
			await withDatabase(async (db) => {
				await db.collection('addonTemplates').deleteMany({ code });
				await db.collection('products').replaceOne({ slug }, original as never);
			});
		}
	});

	test('a renamed value reaches the product that uses it', async ({ page, request }) => {
		const slug = 'printed-blouse-piece';
		const code = `e2e-finish-${Date.now()}`;
		const name = (en: string) => ({ en, fr: `${en} fr` });
		const term = { code: 'matte', slug: 'matte', label: name('Matte'), aliases: [], isBase: false, hidden: false };
		const original = await withDatabase((db) => db.collection('products').findOne({ slug }));
		await withDatabase(async (db) => {
			await db.collection('attributeDefinitions').insertOne({
				_id: `attr_${code}` as never,
				code,
				label: name('Finish'),
				defaultRole: 'descriptive',
				defaultDisplayStyle: 'rectangle',
				valueType: 'term',
				terms: [term],
			});
			await db.collection('products').updateOne(
				{ slug },
				{
					$push: {
						optionGroups: {
							attributeCode: code,
							label: name('Finish'),
							semanticRole: 'filter_only',
							displayStyle: 'rectangle',
							requiredSelection: false,
							defaultTermCode: null,
							terms: [
								{
									code: 'matte',
									label: name('Matte'),
									isBase: false,
									addonTemplateIds: [],
									requiresMeasurements: false,
									sortOrder: 0,
								},
							],
						},
					} as never,
				},
			);
		});
		try {
			await open(page, `/attribute/edit/${code}`);
			await expect(page.locator('#value_0')).toHaveValue('Matte');
			await page.locator('#value_0').fill('Satin');
			await page.locator('#value_0').blur();
			await page.locator('#attribute_btn button, button#attribute_btn').first().click();
			await expect(page).toHaveURL(/\/attribute$/);
			const view = await request.get(`https://localhost:4000/catalog/products/${slug}/view?locale=en`);
			expect(view.status(), await view.text()).toBe(200);
			const body = (await view.json()) as { optionGroups: { code: string; terms: { label: string }[] }[] };
			expect(body.optionGroups.find((group) => group.code === code)?.terms[0]?.label).toBe('Satin');
		} finally {
			await withDatabase(async (db) => {
				await db.collection('attributeDefinitions').deleteMany({ code });
				await db.collection('products').replaceOne({ slug }, original as never);
			});
		}
	});

	test('choosing a category image saves it, and the shop menu can show it', async ({ page, request }) => {
		const slug = `e2e-image-${Date.now()}`;
		await open(page, '/category');
		await page.locator('input[formcontrolname="name"]').fill('Picture Category');
		await page.locator('#slug').fill(slug);
		await page.locator('app-language-switch button', { hasText: 'Français' }).click();
		await expect(page.locator('input[formcontrolname="name"]')).toHaveValue('');
		await page.locator('input[formcontrolname="name"]').fill('Catégorie illustrée');
		await page.locator('app-image-upload .choosefile-input').first().click();
		await page.locator('.modal .library-box label').first().click();
		await page.locator('#media_btn button, button#media_btn').first().click();
		await expect(page.locator('.modal')).toHaveCount(0);
		await page.locator('#category_btn button, button#category_btn').first().click();
		await expect
			.poll(() => withDatabase((db) => db.collection('categories').countDocuments({ slug })))
			.toBe(1);
		try {
			const row = await withDatabase((db) => db.collection('categories').findOne({ slug }));
			expect(row?.['media']?.bannerImage).toEqual(expect.any(String));
			const menu = await request.get('https://localhost:4000/catalog/categories/menu?locale=fr');
			const rows = (await menu.json()) as { slug: string; imageUrl: string | null }[];
			expect(rows.find((category) => category.slug === slug)?.imageUrl).toMatch(/^https?:/);
		} finally {
			await withDatabase(async (db) => {
				await db.collection('categories').deleteMany({ slug });
				await db.collection('categoryPlacements').deleteMany({ pathKey: slug });
			});
		}
	});

	test('the category tree follows the language of the form', async ({ page }) => {
		await open(page, '/category');
		const tree = page.locator('app-tree');
		await expect(tree).toContainText('Sarees');
		await page.locator('app-language-switch button', { hasText: 'Français' }).click();
		await expect(tree).toContainText('Saris');
		await page.locator('app-language-switch button', { hasText: 'English' }).click();
		await expect(tree).toContainText('Sarees');
	});

	test('a role change that would retire saved variants asks first', async ({ page }) => {
		const product = await withDatabase((db) => db.collection('products').findOne({ slug: 'designer-saree-with-blouse' }));
		await open(page, `/product/edit/${String(product?._id)}`);
		await page.locator('.nav-link', { hasText: 'Inventory' }).first().click();
		const asked: string[] = [];
		page.once('dialog', (dialog) => {
			asked.push(dialog.message());
			void dialog.dismiss();
		});
		await page.locator('#role_0 .select2-selection').click();
		await page.locator('.select2-results__option', { hasText: /filter/i }).first().click();
		await expect.poll(() => asked.length).toBe(1);
		expect(asked[0]).toContain('retires its saved variants');
		await expect(page.locator('#role_0 .select2-selection')).toContainText(/variation/i);
	});

	test('an image off 3:4 warns, and a swatch without its colour stops Go Live', async ({ page }) => {
		const slug = 'chikankari-cotton-kurti';
		const original = await withDatabase((db) => db.collection('products').findOne({ slug }));
		const assetId = (original?.['media'] as { gallery: string[] }).gallery[0];
		const asset = await withDatabase((db) => db.collection('mediaAssets').findOne({ _id: assetId as never }));
		const groups = (original?.['optionGroups'] as Array<Record<string, unknown>>).map((group, index) =>
			index === 0
				? {
						...group,
						displayStyle: 'color_swatch',
						terms: (group['terms'] as Array<Record<string, unknown>>).map(({ hex: _hex, ...term }) => term),
					}
				: group,
		);
		await withDatabase(async (db) => {
			await db.collection('mediaAssets').updateOne({ _id: assetId as never }, { $set: { width: 1000, height: 1000 } });
			await db.collection('products').updateOne({ slug }, { $set: { status: 'disabled', optionGroups: groups } });
		});
		try {
			await open(page, `/product/edit/${String(original?._id)}`);
			await page.locator('.nav-link', { hasText: 'Images' }).first().click();
			await expect(page.locator('body')).toContainText('Not 3:4, so it may be cropped: 1');
			await page.locator('.nav-link', { hasText: 'Status' }).first().click();
			await page.locator('#go_live_btn').click();
			await expect(page.locator('.alert-danger')).toContainText('Add a colour for');
		} finally {
			await withDatabase(async (db) => {
				await db
					.collection('mediaAssets')
					.updateOne({ _id: assetId as never }, { $set: { width: asset?.['width'], height: asset?.['height'] } });
				await db.collection('products').replaceOne({ slug }, original as never);
			});
		}
	});

	test('compound photos set in the admin form reach the shop', async ({ page, request }) => {
		const slug = 'designer-saree-with-blouse';
		const original = await withDatabase((db) => db.collection('products').findOne({ slug }));
		await open(page, `/product/edit/${String(original?._id)}`);
		await page.locator('.nav-link', { hasText: 'Images' }).first().click();
		await page.locator('input[name="image_mode"]').nth(1).check();
		await page.locator('app-product-images .variant-accordion .choosefile-input:visible').first().click();
		await page.locator('.modal .library-box label').first().click();
		await page.locator('#media_btn button, button#media_btn').first().click();
		await expect(page.locator('.modal')).toHaveCount(0);
		try {
			await page.getByRole('button', { name: /update product/i }).click();
			await expect(page).toHaveURL(/\/product$/);
			const saved = await withDatabase((db) => db.collection('products').findOne({ slug }));
			expect(saved).toMatchObject({ imageMode: 'compound', status: 'live' });
			const view = await request.get(`https://localhost:4000/catalog/products/${slug}/view`);
			expect(view.status(), await view.text()).toBe(200);
			const body = (await view.json()) as { variants: { galleryIndexes: number[] }[] };
			expect(body.variants.some((row) => row.galleryIndexes.length === 1)).toBe(true);
		} finally {
			await withDatabase((db) => db.collection('products').replaceOne({ slug }, original as never));
		}
	});

	test('the FAQ form holds both languages behind one switch', async ({ page }) => {
		const title = `E2E question ${Date.now()}`;
		await open(page, '/faq/create');
		await page.locator('input[formcontrolname="title"]').fill(title);
		await page.locator('textarea[formcontrolname="description"]').fill('An answer.');
		await page.locator('app-language-switch button', { hasText: 'Français' }).click();
		await expect(page.locator('input[formcontrolname="title"]')).toHaveValue('');
		await page.locator('input[formcontrolname="title"]').fill('Une question');
		await page.locator('textarea[formcontrolname="description"]').fill('Une réponse.');
		await page.locator('#faq_btn button, button#faq_btn').first().click();
		await expect(page).toHaveURL(/\/faq$/);
		const saved = await withDatabase((db) => db.collection('faqEntries').findOne({ 'question.en': title }));
		expect(saved).toMatchObject({ question: { fr: 'Une question' }, answer: { fr: 'Une réponse.' } });
		await withDatabase((db) => db.collection('faqEntries').deleteMany({ 'question.en': title }));
	});
});

test.describe('Language to-do list', () => {
	test('the count lists what is left, and a line jumps to the field', async ({ page }) => {
		await open(page, '/product/create');
		await page.locator('#name').fill('To-do Test');
		const french = page.locator('app-language-switch .btn-group').nth(1);
		await french.locator('[ngbDropdownToggle]').click();
		await french.locator('[ngbDropdownItem]', { hasText: 'Meta Title' }).click();
		await expect(page.locator('#meta_title')).toBeFocused();
		await expect(page.locator('#name')).toHaveValue('');
	});
});

test.describe('Product facts', () => {
	test('saree length shows only for sarees, and the Unit field is gone', async ({ page }) => {
		await open(page, '/product/create');
		await page.locator('.nav-link', { hasText: 'Inventory' }).first().click();
		await expect(page.locator('#unit')).toHaveCount(0);
		await expect(page.locator('#saree_length_m')).toHaveCount(0);
	});

	test('roles read as plain words', async ({ page }) => {
		await open(page, '/attribute/create');
		await expect(page.locator('body')).not.toContainText('variation_axis');
	});
});

test.describe('Size guide', () => {
	test('written once on the template, shown on the product, in inches or centimetres', async ({ page, baseURL }) => {
		const slug = await withDatabase(async (db) => {
			const row = await db.collection('products').findOne({ addonTemplateCode: 'blouse-measurements', status: 'live' });
			return String(row?.['slug']);
		});
		await open(page, '/measurement/edit/blouse-measurements');
		await page.locator('#add_guide_row_btn').click();
		await page.locator('#guide_size_0').fill('M');
		await page.locator('#guide_size_0').blur();
		const cell = page.locator('app-form-fields table tbody input[type=number]').first();
		await cell.fill('36');
		await cell.blur();
		await page.getByRole('button', { name: /save/i }).first().click();
		await expect(page).toHaveURL(/\/measurement$/);
		await page.goto(`https://localhost:4200/en/product/${slug}`);
		await page.locator('.size-delivery-info a', { hasText: 'Size Chart' }).click();
		const table = page.locator('.modal-body table');
		await expect(table).toContainText('36');
		await page.locator('.modal-body .btn-group button', { hasText: 'Centimetres' }).click();
		await expect(table).toContainText('91.4');
		expect(baseURL).toBeDefined();
	});
});

test.describe('Brand Kit', () => {
	test('a saved shop name reaches the public brand at once', async ({ page, request }) => {
		await open(page, '/setting/brand');
		await page.locator('#shop_name').fill('Saha Textile Test');
		await page.locator('#save_brand_btn').click();
		await expect(page.locator('body')).toContainText('Brand Kit saved');
		const brand = await (await request.get('https://localhost:4000/storefront/brand')).json();
		expect(brand.shopName).toBe('Saha Textile Test');
	});

	test('the sidebar logo clears the collapse button', async ({ page }) => {
		await open(page, '/dashboard');
		const toggle = await page.locator('.logo-wrapper .toggle-sidebar').boundingBox();
		const wrapper = await page.locator('.logo-wrapper').boundingBox();
		expect(toggle?.x ?? 0).toBeGreaterThan((wrapper?.x ?? 0) + 200);
	});
});


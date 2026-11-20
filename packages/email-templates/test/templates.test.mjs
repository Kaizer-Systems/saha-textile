import { describe, expect, it } from 'vitest';

import { TEMPLATES, checkTemplate, fillTokens, render, renderSample } from '../src/index.mjs';

const PROD = {
	shop_origin: 'https://sahatextile.com',
	admin_origin: 'https://admin.sahatextile.com',
	legal_name: 'Saha Textile Private Limited',
	shop_address: '00 Example Street, Kolkata, West Bengal 700000, India',
	preview_assets: 'https://sahatextile.com/media',
};

describe('the 24 MSG91 email templates', () => {
	it('has every template once, including order_payment_link and payment_receipt', () => {
		const names = TEMPLATES.map((template) => template.name);
		expect(names).toHaveLength(24);
		expect(new Set(names).size).toBe(24);
		expect(names).toEqual(
			expect.arrayContaining(['order_payment_link', 'payment_receipt', 'order_confirmed', 'otp_login']),
		);
	});

	it('passes MSG91’s Handlebars subset and our email rules, subjects included', () => {
		const problems = TEMPLATES.flatMap((template) => [
			...checkTemplate(template.name, render(template)),
			...checkTemplate(`${template.name} subject`, template.subject),
		]);
		expect(problems).toEqual([]);
	});

	it('refuses what MSG91 or our rules forbid', () => {
		expect(checkTemplate('x', '{{#with a}}{{/with}}')).toEqual(['x: helper “with” is not available on MSG91']);
		expect(checkTemplate('x', '<script>alert(1)</script>')).toEqual(['x: script, form or iframe found']);
		expect(checkTemplate('x', '<img src="logo.webp">')).toEqual(
			expect.arrayContaining(['x: WebP image (use PNG or JPG)']),
		);
	});

	it('keeps marketing mail alone with an unsubscribe link', () => {
		for (const template of TEMPLATES) {
			const source = render(template);
			expect(source.includes('{{unsubscribe_url}}'), template.name).toBe(template.kind === 'marketing');
		}
	});

	it('keeps a 25-line order confirmation under Gmail’s ~102 KB clipping limit', () => {
		const confirmed = TEMPLATES.find((template) => template.name === 'order_confirmed');
		const many = Array.from({ length: 25 }, (_, n) => ({
			image: 'https://cdn.sahatextile.com/media/products/red-banarasi-katan-silk-saree-gold-zari-160w-0a1b2c3d.jpg',
			name: `Red Banarasi Katan Silk Saree with Gold Zari Border, piece ${n + 1}`,
			options: 'Colour: Deep Red · Blouse: Unstitched · Fall and pico: Yes',
			quantity: '2',
			price: '₹10,200',
			total: '₹20,400',
			note: 'Made to order: dispatch by 5 Dec',
		}));
		// Sample values carry their own image marks, so the marks are filled after rendering too, as the brief's build did.
		const html = fillTokens(
			renderSample(fillTokens(render(confirmed), PROD), {
				...confirmed.sample,
				items: many,
				has_cancel_note: true,
			}),
			PROD,
		);
		expect(Buffer.byteLength(html) / 1024).toBeLessThan(102);
		expect(html).toContain('piece 25');
		expect(html).not.toMatch(/\[\[[a-z_]+\]\]/);
	});
});

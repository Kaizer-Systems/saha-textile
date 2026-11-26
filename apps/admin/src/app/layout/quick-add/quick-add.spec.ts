import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import { AuthStore } from '@core/state/auth.store';

import { QuickAdd } from './quick-add';

@Component({ template: '' })
class Blank {}

const permissions = signal<string[]>([]);

async function render(granted: string[], url = '/dashboard') {
	permissions.set(granted);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [
			QuickAdd,
			TranslocoTestingModule.forRoot({
				langs: {
					en: { add_product: 'Add Product', add_order: 'Add Order', quick_add: 'Add new', close: 'Close' },
				},
				translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
				preloadLangs: true,
			}),
		],
		providers: [
			provideRouter([{ path: '**', component: Blank }]),
			{ provide: AuthStore, useValue: { permissions } },
		],
	});
	const router = TestBed.inject(Router);
	await router.navigateByUrl(url);
	const fixture = TestBed.createComponent(QuickAdd);
	document.body.appendChild(fixture.nativeElement as HTMLElement);
	fixture.detectChanges();
	const el = fixture.nativeElement as HTMLElement;
	const toggle = () => el.querySelector<HTMLButtonElement>('#quick_add_toggle');
	const menu = () => el.querySelector<HTMLElement>('#quick_add_menu');
	return { fixture, el, router, toggle, menu };
}

describe('the floating quick add', () => {
	it('shows nothing to someone who may add neither products nor orders', async () => {
		const { el } = await render(['order.index']);
		expect(el.querySelector('.adm-theme-option')).toBeNull();
	});

	it('goes straight to the one page someone may use, named on hover', async () => {
		const { el } = await render(['order.create']);
		const link = el.querySelector<HTMLAnchorElement>('#quick_add_order');
		expect(link?.getAttribute('href')).toBe('/order/create');
		expect(link?.title).toBe('Add Order');
		expect(link?.getAttribute('aria-label')).toBe('Add Order');
		expect(el.querySelector('#quick_add_toggle')).toBeNull();
	});

	it('opens both named actions from one "+", and closes with ×, Escape or a click outside', async () => {
		const { el, fixture, toggle, menu } = await render(['product.create', 'order.create']);
		expect(toggle()?.title).toBe('Add new');
		expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
		expect(menu()?.classList.contains('active')).toBe(false);
		expect(
			[...el.querySelectorAll('#quick_add_menu a')].map((a) => [
				a.id,
				a.getAttribute('href'),
				a.textContent?.trim(),
			]),
		).toEqual([
			['quick_add_product', '/product/create', 'Add Product'],
			['quick_add_order', '/order/create', 'Add Order'],
		]);

		toggle()?.click();
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(true);
		expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
		expect(toggle()?.title).toBe('Close');
		expect(toggle()?.querySelector('i')?.className).toBe('ri-close-line');

		// a click inside keeps it open; a click outside closes it
		menu()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(true);
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(false);

		// a click outside while closed changes nothing
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(false);

		toggle()?.click();
		fixture.detectChanges();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(false);

		toggle()?.click();
		fixture.detectChanges();
		toggle()?.click();
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(false);
		fixture.destroy();
	});

	it('closes once an action is chosen', async () => {
		const { fixture, toggle, menu, el } = await render(['product.create', 'order.create']);
		toggle()?.click();
		fixture.detectChanges();
		el.querySelector<HTMLAnchorElement>('#quick_add_product')?.click();
		fixture.detectChanges();
		expect(menu()?.classList.contains('active')).toBe(false);
		fixture.destroy();
	});

	it('leaves out the action whose page is open, and follows the page as you move', async () => {
		const { fixture, el, router } = await render(
			['product.create', 'order.create'],
			'/product/create?from=list#top',
		);
		expect(el.querySelector('#quick_add_toggle')).toBeNull();
		expect(el.querySelector('#quick_add_order')?.getAttribute('href')).toBe('/order/create');

		await router.navigateByUrl('/order/create');
		fixture.detectChanges();
		expect(el.querySelector('#quick_add_product')?.getAttribute('href')).toBe('/product/create');

		await router.navigateByUrl('/dashboard');
		fixture.detectChanges();
		expect(el.querySelector('#quick_add_toggle')).not.toBeNull();
		fixture.destroy();
	});
});

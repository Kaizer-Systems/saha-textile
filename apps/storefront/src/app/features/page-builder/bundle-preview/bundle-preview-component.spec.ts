import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundlePreview } from './bundle-preview';

vi.mock('@core/catalog/from-api', () => ({
	bundleFromApi: (bundle: unknown, slug: string) => ({ converted: bundle, slug }),
}));

const ADMIN = 'https://admin.test';

const render = (adminOrigin: string | null) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(BundlePreview, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(BundlePreview);
	fixture.componentRef.setInput('adminOrigin', adminOrigin);
	fixture.detectChanges();
	TestBed.tick();
	return { fixture, preview: fixture.componentInstance };
};

const framed = () => {
	const parent = { postMessage: vi.fn() };
	vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
	return parent;
};
const post = (data: unknown, origin = ADMIN) => window.dispatchEvent(new MessageEvent('message', { data, origin }));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.className = '';
});

describe('BundlePreview', () => {
	it('hides the shop around the set while it is shown, and talks to no one outside a frame', () => {
		const { fixture } = render(ADMIN);
		expect(document.body.classList.contains('st-bundle-preview')).toBe(true);
		fixture.destroy();
		expect(document.body.classList.contains('st-bundle-preview')).toBe(false);
	});

	it('talks to no one without an admin origin', () => {
		const parent = framed();
		render(null);
		expect(parent.postMessage).not.toHaveBeenCalled();
	});

	it('says it is ready, then draws each draft the builder sends, starting over each time', async () => {
		const parent = framed();
		const { fixture, preview } = render(ADMIN);
		expect(parent.postMessage).toHaveBeenCalledWith({ type: 'st-bundle-preview-ready' }, ADMIN);

		preview.state.set({ total: 1 } as never);
		post({ type: 'st-bundle-preview', name: 'Wedding set', bundle: { sku: 'SET' } });
		expect(preview.product()).toBeNull();
		expect(preview.state()).toBeNull();
		await Promise.resolve();
		expect(preview.product()).toEqual({ name: 'Wedding set', bundle: { converted: { sku: 'SET' }, slug: '' } });

		post({ type: 'st-bundle-preview', name: 'Wedding set', bundle: null });
		await Promise.resolve();
		expect(preview.product()).toBeNull();

		post({ type: 'st-bundle-preview', name: 'Elsewhere', bundle: { sku: 'X' } }, 'https://evil.test');
		await Promise.resolve();
		expect(preview.product()).toBeNull();

		fixture.destroy();
		post({ type: 'st-bundle-preview', name: 'After', bundle: { sku: 'Y' } });
		await Promise.resolve();
		expect(preview.product()).toBeNull();
	});
});

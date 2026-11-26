import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { HeadPreload } from '@core/media/head-preload';

import { ImageLink } from './image-link';

const picture = (url: string) => ({ roles: { banner: [{ url }] } });

const render = (inputs: Record<string, unknown>) => {
	const preload = { picture: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [{ provide: HeadPreload, useValue: preload }] });
	TestBed.overrideComponent(ImageLink, { set: { imports: [], template: '' } });
	const fixture = TestBed.createComponent(ImageLink);
	for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
	fixture.detectChanges();
	return preload.picture;
};

describe('ImageLink: preloading the early picture', () => {
	it('preloads nothing for a plain image, or a banner that is neither early nor the hero’s main one', () => {
		expect(render({})).not.toHaveBeenCalled();
		expect(render({ image: { url: 'x' } })).not.toHaveBeenCalled();
		const side = { position: 'hero', slot: 'side', images: { desktop: picture('/d.webp') } };
		expect(render({ image: { resolved: side } })).not.toHaveBeenCalled();
	});

	it('preloads the hero’s main banner per band it has', () => {
		const main = {
			position: 'hero',
			slot: 'main',
			images: { phone: picture('/p.webp'), desktop: picture('/d.webp') },
		};
		const preload = render({ image: { resolved: main }, sizes: '66vw' });
		expect(preload.mock.calls.map(([call]) => call)).toEqual([
			expect.objectContaining({
				href: '/p.webp',
				sizes: '100vw',
				media: '(max-width: 767px) and (orientation: portrait)',
			}),
			expect.objectContaining({ href: '/d.webp', sizes: '66vw' }),
		]);
	});

	it('preloads any banner marked early', () => {
		const strip = {
			position: 'strip',
			slot: 'main',
			images: { tablet: picture('/t.webp'), desktop: picture('/d.webp') },
		};
		expect(render({ image: { resolved: strip }, priority: true })).toHaveBeenCalledTimes(2);
	});
});

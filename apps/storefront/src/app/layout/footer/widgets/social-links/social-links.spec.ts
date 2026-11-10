import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { SocialLinks } from './social-links';

const brand = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@data-access/queries/brand.queries', () => ({
	injectBrandQuery: () => ({ data: () => brand.data }),
}));

const links = () => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(SocialLinks, { set: { imports: [], template: '' } });
	return TestBed.createComponent(SocialLinks).componentInstance.profiles();
};

describe('SocialLinks', () => {
	it('lists only the Brand Kit profiles that are set, in footer order', () => {
		brand.data = {
			socials: {
				instagram: 'https://www.instagram.com/shop/',
				facebook: 'https://www.facebook.com/shop',
				x: '',
				youtube: 'https://www.youtube.com/@Shop',
			},
		};
		expect(links().map((profile) => [profile.label, profile.href])).toEqual([
			['Facebook', 'https://www.facebook.com/shop'],
			['Instagram', 'https://www.instagram.com/shop/'],
			['YouTube', 'https://www.youtube.com/@Shop'],
		]);
	});

	it('shows nothing before the Brand Kit answers', () => {
		brand.data = undefined;
		expect(links()).toEqual([]);
	});
});

import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { ImageLink } from './image-link';

describe('ImageLink', () => {
	it('recognises the hero main banner', () => {
		TestBed.resetTestingModule();
		TestBed.overrideComponent(ImageLink, { set: { imports: [], template: '' } });
		const link = TestBed.createComponent(ImageLink).componentInstance;
		expect(link.isHeroMain({ position: 'hero', slot: 'main' })).toBe(true);
		expect(link.isHeroMain({ position: 'hero', slot: 'side' })).toBe(false);
		expect(link.isHeroMain({ position: 'strip', slot: 'main' })).toBe(false);
		expect(link.src({ roles: { banner: [{ url: 'a' }, { url: 'b' }] } } as never)).toBe('b');
		expect(link.src({ roles: {} } as never)).toBe('');
		expect(link.srcset(null)).toBeNull();
	});
});

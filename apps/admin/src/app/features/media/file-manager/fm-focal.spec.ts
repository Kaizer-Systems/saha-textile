import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { describe, expect, it, vi } from 'vitest';

import { FmFocal, previewPosition } from './fm-focal';

vi.mock('@data-access/queries/media-profiles.queries', async (original) => ({
	...(await original<object>()),
	injectMediaProfilesQuery: () => ({
		data: () => [
			{ profile: { key: 'product_3x4', builtIn: true, shape: { width: 3, height: 4 } }, photos: 0 },
			{ profile: { key: 'hero_21x9', builtIn: true, shape: { width: 21, height: 9 } }, photos: 0 },
		],
	}),
}));

describe('the focal point previews (C06, step 3c)', () => {
	it('places the photo exactly where the worker crops: centred on the point, kept inside the photo', () => {
		const wide = { width: 4000, height: 2000 };
		// A 3:4 window in a 2:1 photo is 1500 wide: centred, it starts at 1250 of the 2500 it can move.
		expect(previewPosition(wide, { width: 3, height: 4 }, { x: 0.5, y: 0.5 })).toBe('50% 50%');
		expect(previewPosition(wide, { width: 3, height: 4 }, { x: 0, y: 0.5 })).toBe('0% 50%');
		expect(previewPosition(wide, { width: 3, height: 4 }, { x: 1, y: 0.5 })).toBe('100% 50%');
		// Point at x = 0.3 → window starts at 1200 − 750 = 450 of 2500 → 18%.
		expect(previewPosition(wide, { width: 3, height: 4 }, { x: 0.3, y: 0.5 })).toBe('18% 50%');
		// A box wider than the photo moves only up and down.
		expect(previewPosition({ width: 2000, height: 2000 }, { width: 21, height: 9 }, { x: 0.9, y: 0.2 })).toBe(
			'50% 0%',
		);
	});

	it('a click sets the point; Save answers it, Reset to centre answers null', () => {
		const modal = { close: vi.fn(), dismiss: vi.fn() };
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({
			providers: [
				{ provide: NgbActiveModal, useValue: modal },
				{ provide: TranslocoService, useValue: { translate: (key: string) => key, getActiveLang: () => 'en' } },
			],
		});
		TestBed.overrideComponent(FmFocal, { set: { imports: [], template: '' } });
		const popup = TestBed.createComponent(FmFocal).componentInstance;
		popup.start({
			name: 'weave.jpg',
			picture: 'blob:x',
			width: 4000,
			height: 2000,
			focal: null,
			crops: ['product_3x4'],
		});
		expect(popup.point()).toEqual({ x: 0.5, y: 0.5 });
		expect(popup.previews()).toEqual([
			expect.objectContaining({ key: 'product_3x4', withPoint: '50% 50%', today: '50% 50%' }),
		]);
		const box = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }) };
		popup.pick({ currentTarget: box, clientX: 220, clientY: 90 } as unknown as MouseEvent);
		expect(popup.point()).toEqual({ x: 0.3, y: 0.2 });
		expect(popup.previews()[0]?.withPoint).toBe('18% 50%');
		popup.save();
		expect(modal.close).toHaveBeenLastCalledWith({ focal: { x: 0.3, y: 0.2 } });
		popup.reset();
		expect(modal.close).toHaveBeenLastCalledWith({ focal: null });
	});
});

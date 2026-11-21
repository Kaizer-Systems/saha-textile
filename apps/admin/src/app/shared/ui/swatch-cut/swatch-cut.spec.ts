import { TestBed } from '@angular/core/testing';

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaLibraryGateway } from '@core/media-library/media-library.gateway';

import { CUT_LOOKS, SwatchCut } from './swatch-cut';

const photo = {
	photoId: 'med_photo',
	name: 'peacock.jpg',
	url: 'https://cdn.test/gallery-900.webp',
	width: 1800,
	height: 2400,
	cutId: null,
	region: null,
};

const render = (source: unknown = photo) => {
	const modal = { close: vi.fn(), dismiss: vi.fn() };
	const gateway = {
		cutSource: vi.fn(() => (source instanceof Error ? throwError(() => source) : of(source))),
		cut: vi.fn(() => of({ id: 'med_cut', versionId: 'swatch_1x1.as_is', px: 600, soft: false, created: true })),
	};
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: MediaLibraryGateway, useValue: gateway },
			{ provide: TranslocoService, useValue: { translate: (key: string) => key } },
		],
	});
	TestBed.overrideComponent(SwatchCut, { set: { imports: [], template: '', styleUrls: [] } });
	const cut = TestBed.createComponent(SwatchCut).componentInstance;
	return { cut, modal, gateway };
};

describe('SwatchCut (brief P11)', () => {
	it('starts on a 600 px square in the middle of the photo, drawn in the four picture looks', async () => {
		const { cut, gateway } = render();
		expect([cut.region(), cut.previewValues()]).toEqual([null, []]);
		await cut.start({ pictureId: 'med_photo', valueName: 'Shadow work', price: 750 });
		expect(gateway.cutSource).toHaveBeenCalledWith('med_photo');
		expect([cut.zoom(), cut.px(), cut.soft()]).toEqual([3, 600, false]);
		expect(cut.region()).toEqual({ x: expect.closeTo(1 / 3), y: 0.375, width: 1 / 3, height: 0.25 });
		expect(cut.previewValues()).toEqual([
			{ label: 'Shadow work', picture: photo.url, crop: cut.region(), price: 750 },
		]);
		expect(CUT_LOOKS).toEqual(['image_swatch', 'image_tile', 'picture_row', 'picture_chip']);
	});

	it('reopens on the square of the cut the value already uses', async () => {
		const region = { x: 0.1, y: 0.6, width: 400 / 1800, height: 400 / 2400 };
		const { cut } = render({ ...photo, cutId: 'med_cut', region });
		await cut.start({ pictureId: 'med_cut', valueName: 'Shadow work' });
		expect(cut.zoom()).toBeCloseTo(4.5);
		expect(cut.zoomLabel()).toBe('4.5');
		expect(cut.px()).toBe(400);
		expect(cut.region()?.x).toBeCloseTo(0.1);
		expect(cut.region()?.y).toBeCloseTo(0.6);
		expect(cut.previewValues()[0]?.price).toBe(0);
	});

	it('zooms between 1 and 6, says when the square will look soft, and keeps it inside the photo', async () => {
		const { cut } = render();
		await cut.start({ pictureId: 'med_photo', valueName: 'Floral' });
		cut.setZoom(9);
		expect([cut.zoom(), cut.px(), cut.soft()]).toEqual([6, 300, true]);
		cut.setZoom(0.2);
		expect([cut.zoom(), cut.px()]).toEqual([1, 1800]);
		cut.setZoom(3);
		cut.placeAt(0, 0);
		expect(cut.region()).toMatchObject({ x: 0, y: 0 });
		cut.placeAt(1, 1);
		expect(cut.region()?.x).toBeCloseTo(2 / 3);
		expect(cut.region()?.y).toBeCloseTo(0.75);
		cut.move(-1, -1);
		expect(cut.region()).toMatchObject({ x: 0, y: 0 });
	});

	it('follows a drag on the photo and nudges with the arrow keys', async () => {
		const { cut } = render();
		await cut.start({ pictureId: 'med_photo', valueName: 'Floral' });
		const box = {
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }),
			setPointerCapture: vi.fn(),
		};
		const pointer = (x: number, y: number) =>
			({ currentTarget: box, clientX: x, clientY: y, pointerId: 1 }) as never;
		cut.follow(pointer(0, 0));
		expect(cut.centre()).toEqual({ x: 0.5, y: 0.5 });
		cut.press(pointer(150, 100));
		expect(box.setPointerCapture).toHaveBeenCalledWith(1);
		expect(cut.centre()).toEqual({ x: 0.5, y: 0.25 });
		cut.follow(pointer(150, 300));
		expect(cut.centre()).toEqual({ x: 0.5, y: 0.75 });
		cut.release();
		cut.follow(pointer(0, 0));
		expect(cut.centre()).toEqual({ x: 0.5, y: 0.75 });
		cut.follow({ currentTarget: { getBoundingClientRect: () => ({ width: 0, height: 0 }) } } as never);
		const key = (name: string, shiftKey = false) => ({ key: name, shiftKey, preventDefault: vi.fn() }) as never;
		cut.nudge(key('ArrowLeft'));
		expect(cut.centre().x).toBeCloseTo(0.49);
		cut.nudge(key('ArrowDown', true));
		expect(cut.centre().y).toBeCloseTo(0.8);
		cut.nudge(key('ArrowRight'));
		cut.nudge(key('ArrowUp'));
		expect(cut.centre()).toEqual({ x: 0.5, y: expect.closeTo(0.79) });
		const other = key('Enter');
		cut.nudge(other);
		expect(
			(other as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault,
		).not.toHaveBeenCalled();
	});

	it('saves the cut and hands it back, or uses the whole photo', async () => {
		const { cut, modal, gateway } = render();
		await cut.save();
		cut.useWhole();
		expect(modal.close).not.toHaveBeenCalled();
		await cut.start({ pictureId: 'med_photo', valueName: 'Floral' });
		await cut.save();
		expect(gateway.cut).toHaveBeenCalledWith('med_photo', { region: cut.region() });
		expect(modal.close).toHaveBeenCalledWith({ kind: 'cut', id: 'med_cut', versionId: 'swatch_1x1.as_is' });
		cut.useWhole();
		expect(modal.close).toHaveBeenLastCalledWith({ kind: 'whole', photoId: 'med_photo' });
	});

	it('says in words what went wrong, and does nothing while the move or a save is on its way', async () => {
		const failed = render(new Error('offline'));
		await failed.cut.start({ pictureId: 'med_photo', valueName: 'Floral' });
		expect(failed.cut.problem()).toBe('cut_failed');
		failed.cut.move(0.1, 0);
		failed.cut.placeAt(0.1, 0.1);
		expect(failed.cut.centre()).toEqual({ x: 0.5, y: 0.5 });

		const { cut, gateway, modal } = render();
		await cut.start({ pictureId: 'med_photo', valueName: 'Floral' });
		gateway.cut.mockReturnValueOnce(throwError(() => new Error('nope')));
		await cut.save();
		expect([cut.problem(), cut.saving()]).toEqual(['cut_failed', false]);
		cut.saving.set(true);
		await cut.save();
		expect(gateway.cut).toHaveBeenCalledTimes(1);
		expect(modal.close).not.toHaveBeenCalled();
	});
});

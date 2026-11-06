import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GalleryFullscreen } from './gallery-fullscreen';

const swiper = vi.hoisted(() => ({ created: [] as unknown[][], destroy: vi.fn() }));
vi.mock('swiper', () => ({
	default: class {
		destroy = swiper.destroy;
		constructor(...args: unknown[]) {
			swiper.created.push(args);
		}
	},
}));
vi.mock('swiper/modules', () => ({ Keyboard: 'keyboard', Navigation: 'navigation', Zoom: 'zoom' }));

const render = (platform = 'browser') => {
	const modal = { dismiss: vi.fn() };
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: NgbActiveModal, useValue: modal },
			{ provide: PLATFORM_ID, useValue: platform },
		],
	});
	TestBed.overrideComponent(GalleryFullscreen, { set: { imports: [], template: '<div #container></div>' } });
	const fixture = TestBed.createComponent(GalleryFullscreen);
	fixture.componentInstance.start = 2;
	fixture.detectChanges();
	return { fixture, gallery: fixture.componentInstance, modal };
};

afterEach(() => {
	swiper.created.length = 0;
	swiper.destroy.mockClear();
	history.replaceState(null, '');
});

describe('GalleryFullscreen', () => {
	it('does nothing on the server', () => {
		const { fixture } = render('server');
		expect(swiper.created).toEqual([]);
		fixture.destroy();
		expect(swiper.destroy).not.toHaveBeenCalled();
	});

	it('starts on the chosen slide and adds a history entry', () => {
		render();
		expect(swiper.created[0]?.[1]).toMatchObject({ initialSlide: 2, zoom: { maxRatio: 3 } });
		expect(history.state).toEqual({ 'saha-textile-gallery': true });
	});

	it('closes on the back button', () => {
		const { modal } = render();
		window.dispatchEvent(new PopStateEvent('popstate'));
		expect(modal.dismiss).toHaveBeenCalledWith('back');
	});

	it('closes on the button', () => {
		const { gallery, modal } = render();
		gallery.close();
		expect(modal.dismiss).toHaveBeenCalledWith('close');
	});

	it('drops its history entry when closed by the button', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const { fixture, modal } = render();
		fixture.destroy();
		expect(back).toHaveBeenCalledOnce();
		expect(swiper.destroy).toHaveBeenCalledWith(true, true);
		window.dispatchEvent(new PopStateEvent('popstate'));
		expect(modal.dismiss).not.toHaveBeenCalled();
		back.mockRestore();
	});

	it('leaves history alone when the back button already removed the entry', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
		const { fixture } = render();
		history.replaceState(null, '');
		fixture.destroy();
		expect(back).not.toHaveBeenCalled();
		back.mockRestore();
	});

	it('survives being destroyed before the slider existed', () => {
		const { fixture, gallery } = render();
		(gallery as unknown as { swiper: null }).swiper = null;
		expect(() => fixture.destroy()).not.toThrow();
	});
});

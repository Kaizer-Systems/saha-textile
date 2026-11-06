import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { GalleryZoomLens } from './gallery-zoom-lens';

const image = {
	id: '1',
	src: 'https://cdn.example/card.webp',
	srcset: null,
	zoomSrc: 'https://cdn.example/zoom-2000.webp',
	width: 600,
	height: 800,
};

describe('gallery zoom lens', () => {
	const render = (hover: boolean) => {
		window.matchMedia = () =>
			({ matches: hover, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ imports: [GalleryZoomLens] });
		const fixture = TestBed.createComponent(GalleryZoomLens);
		fixture.componentRef.setInput('image', image);
		fixture.detectChanges();
		return fixture;
	};
	const point = (pointerType: string) => ({ pointerType, clientX: 1, clientY: 1 }) as PointerEvent;

	it('never magnifies for touch, or on a screen with no hover', () => {
		const touch = render(true);
		touch.componentInstance.enter(point('touch'));
		touch.componentInstance.move(point('touch'));
		expect(touch.componentInstance.active()).toBe(false);
		const noHover = render(false);
		noHover.componentInstance.enter(point('mouse'));
		noHover.componentInstance.move(point('mouse'));
		expect(noHover.componentInstance.active()).toBe(false);
	});

	it('does not request the zoom file until a mouse hover', () => {
		window.matchMedia = () =>
			({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
		TestBed.configureTestingModule({ imports: [GalleryZoomLens] });
		const fixture = TestBed.createComponent(GalleryZoomLens);
		fixture.componentRef.setInput('image', image);
		fixture.componentRef.setInput('priority', true);
		fixture.detectChanges();
		const root: HTMLElement = fixture.nativeElement;
		expect(root.querySelectorAll('img')).toHaveLength(1);
		expect(root.innerHTML).not.toContain('zoom-2000');
		root.querySelector('div')?.dispatchEvent(
			new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: true }),
		);
		fixture.detectChanges();
		expect(root.innerHTML).toContain('zoom-2000');
	});
});

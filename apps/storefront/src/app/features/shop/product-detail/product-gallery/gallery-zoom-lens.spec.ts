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

import { afterEach, describe, expect, it } from 'vitest';

import { installPictureFallback } from './picture-fallback';

const MEDIA = 'https://cdn.test/media/med_7Hk2/red-card-400w-1f3a9c2e.webp';

/** An image whose drawn size, attributes and load state are set by the test (jsdom draws nothing). */
function image(options: { width?: number; attr?: number; box?: number; failedBefore?: boolean } = {}) {
	const img = document.createElement('img');
	if (options.attr !== undefined) img.setAttribute('width', String(options.attr));
	if (options.attr !== undefined) img.setAttribute('height', String((options.attr * 4) / 3));
	Object.defineProperty(img, 'width', { value: options.width ?? 0 });
	Object.defineProperty(img, 'height', { value: options.width ? (options.width * 4) / 3 : 0 });
	const box = options.box ?? 0;
	img.getBoundingClientRect = () => ({ width: box, height: (box * 4) / 3 }) as DOMRect;
	if (options.failedBefore !== undefined) {
		Object.defineProperty(img, 'complete', { value: true });
		Object.defineProperty(img, 'naturalWidth', { value: options.failedBefore ? 0 : 300 });
	}
	img.src = MEDIA;
	return img;
}

describe('the missing-picture placeholder: sizes, sources and the theme', () => {
	let stop: (() => void) | null = null;
	afterEach(() => {
		stop?.();
		stop = null;
		document.body.innerHTML = '';
		document.body.classList.remove('dark-only');
	});

	it('reads the dark theme from the page when no reader is given', () => {
		stop = installPictureFallback(document);
		const light = image({ width: 300 });
		document.body.append(light);
		light.dispatchEvent(new Event('error'));
		expect(light.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');
		document.body.classList.add('dark-only');
		const dark = image({ width: 300 });
		document.body.append(dark);
		dark.dispatchEvent(new Event('error'));
		expect(dark.getAttribute('src')).toBe('assets/images/placeholder/placeholder-dark-3x4.svg');
	});

	it('takes the size from the width attribute, then from the drawn box, when the picture has none of its own', () => {
		stop = installPictureFallback(document, () => false);
		const fromAttribute = image({ attr: 300 });
		const fromBox = image({ box: 300 });
		document.body.append(fromAttribute, fromBox);
		fromAttribute.dispatchEvent(new Event('error'));
		fromBox.dispatchEvent(new Event('error'));
		expect(fromAttribute.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');
		expect(fromBox.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');
	});

	it("clears the picture's other sources too, so the browser cannot pick a failing one again", () => {
		stop = installPictureFallback(document, () => false);
		const picture = document.createElement('picture');
		const source = document.createElement('source');
		source.setAttribute('srcset', `${MEDIA} 400w`);
		const img = image({ width: 300 });
		picture.append(source, img);
		document.body.append(picture);
		img.dispatchEvent(new Event('error'));
		expect(source.hasAttribute('srcset')).toBe(false);
		expect(img.dataset['fallback']).toBe('1');
	});

	it('ignores failures of anything that is not a picture', () => {
		stop = installPictureFallback(document, () => false);
		const script = document.createElement('script');
		document.body.append(script);
		script.dispatchEvent(new Event('error'));
		expect(script.dataset['fallback']).toBeUndefined();
	});

	it('swaps pictures that failed before it started, and only those', () => {
		const failed = image({ width: 300, failedBefore: true });
		const loaded = image({ width: 300, failedBefore: false });
		document.body.append(failed, loaded);
		stop = installPictureFallback(document, () => false);
		expect(failed.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');
		expect(loaded.getAttribute('src')).toBe(MEDIA);
	});

	it('draws the light placeholder for a page with no body yet', () => {
		let listener: ((event: Event) => void) | null = null;
		const page = {
			body: null,
			images: [],
			addEventListener: (_type: string, handler: (event: Event) => void) => (listener = handler),
			removeEventListener: () => undefined,
		} as unknown as Document;
		stop = installPictureFallback(page);
		const img = image({ width: 300 });
		listener?.({ target: img } as unknown as Event);
		expect(img.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');
	});
});

import { afterEach, describe, expect, it } from 'vitest';

import { installPictureFallback } from './picture-fallback';

describe('the missing-picture placeholder (R5-1, R5-5; media step 5)', () => {
	let stop: (() => void) | null = null;
	afterEach(() => {
		stop?.();
		document.body.innerHTML = '';
	});

	const picture = (src: string, width = 300, height = 400) => {
		const img = document.createElement('img');
		img.setAttribute('width', String(width));
		img.setAttribute('height', String(height));
		img.setAttribute('srcset', `${src} 300w`);
		img.src = src;
		document.body.append(img);
		return img;
	};

	it('swaps a failed Media picture for the placeholder of its shape, once, keeping its box', () => {
		let dark = false;
		stop = installPictureFallback(document, () => dark);
		const card = picture('https://cdn.test/media/med_7Hk2/red-card-400w-1f3a9c2e.webp');
		card.dispatchEvent(new Event('error'));
		expect(card.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');
		expect(card.hasAttribute('srcset')).toBe(false);
		expect(card.getAttribute('width')).toBe('300');
		// A second failure (the placeholder itself) never loops.
		card.dispatchEvent(new Event('error'));
		expect(card.getAttribute('src')).toBe('assets/images/placeholder/placeholder-light-3x4.svg');

		dark = true;
		const hero = picture('https://cdn.test/media/med_9/hero-1920w-aa.webp', 2100, 900);
		hero.dispatchEvent(new Event('error'));
		expect(hero.getAttribute('src')).toBe('assets/images/placeholder/placeholder-dark-21x9.svg');
	});

	it('leaves other pictures alone', () => {
		stop = installPictureFallback(document, () => false);
		const logo = picture('https://cdn.test/assets/logo.png');
		logo.dispatchEvent(new Event('error'));
		expect(logo.getAttribute('src')).toBe('https://cdn.test/assets/logo.png');
	});
});

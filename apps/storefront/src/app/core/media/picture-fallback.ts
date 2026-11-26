import { isMediaPictureUrl, placeholderFile, placeholderShape } from '@saha-textile/core-domain/media-placeholder';

/** Where the bundled placeholders sit (public/assets/images/placeholder, R5-1). */
const PLACEHOLDER_BASE = 'assets/images/placeholder';

/**
 * The missing-picture placeholder (Media brief R5-5): when a Media picture fails to load, it becomes the bundled
 * placeholder of the nearest shape, light or dark, so the box keeps its size and nothing jumps. A picture is swapped
 * every time a Media address fails on it: the app can set its address again after a swap (hydration does), and the
 * placeholder itself is not a Media address, so it never loops. Other pictures (logos, icons, outside images) are left
 * alone. Pictures that failed before the app started are swapped too. Browser only.
 */
export function installPictureFallback(
	doc: Document,
	isDark: () => boolean = () => doc.documentElement.classList.contains('dark'),
): () => void {
	const swap = (img: HTMLImageElement): void => {
		if (!isMediaPictureUrl(img.currentSrc || img.src)) return;
		const box = img.getBoundingClientRect();
		const width = img.width || Number(img.getAttribute('width')) || box.width;
		const height = img.height || Number(img.getAttribute('height')) || box.height;
		img.dataset['fallback'] = '1';
		img.removeAttribute('srcset');
		img.closest('picture')
			?.querySelectorAll('source')
			.forEach((source) => source.removeAttribute('srcset'));
		img.src = `${PLACEHOLDER_BASE}/${placeholderFile(placeholderShape(width, height), isDark())}`;
	};
	const onError = (event: Event): void => {
		if (event.target instanceof HTMLImageElement) swap(event.target);
	};
	doc.addEventListener('error', onError, true);
	for (const img of Array.from(doc.images)) if (img.complete && img.naturalWidth === 0 && img.src) swap(img);
	return () => doc.removeEventListener('error', onError, true);
}

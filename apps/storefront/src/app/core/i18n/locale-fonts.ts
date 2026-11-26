/**
 * The font file each language's text is drawn in first, preloaded like the English face in `index.html`. বাংলা pages
 * draw nearly all their words in Noto Sans Bengali; without the preload the first paint used another font and the
 * words moved when it arrived (a layout shift of 0.002 on phones, 17 Nov). With it, the critical CSS keeps the face
 * (it keeps only preloaded faces) and the first paint already has it. When the file is still on its way at the first
 * paint, the face's `font-display: optional` keeps the device's font on that page instead of moving every word (CI
 * measured 0.0081 with `swap`, 24 Nov). English needs nothing more than `index.html`.
 */
export const LOCALE_FONT_PRELOADS: Readonly<Record<string, readonly string[]>> = {
	bn: ['/assets/fonts/text/noto-sans-bengali-normal-400-600-bengali.woff2'],
};

/** Adds the language's font preloads to the head, after the English one, once. */
export function preloadLocaleFonts(page: Document, locale: string): void {
	for (const href of LOCALE_FONT_PRELOADS[locale] ?? []) {
		if (page.head.querySelector(`link[rel="preload"][href="${href}"]`)) continue;
		const link = page.createElement('link');
		link.setAttribute('rel', 'preload');
		link.setAttribute('href', href);
		link.setAttribute('as', 'font');
		link.setAttribute('type', 'font/woff2');
		link.setAttribute('crossorigin', '');
		const english = page.head.querySelector('link[rel="preload"][as="font"]');
		if (english?.nextSibling) page.head.insertBefore(link, english.nextSibling);
		else page.head.appendChild(link);
	}
}

/** The dark theme, built from `src/scss/dark.scss` by the `styles` script. */
export const DARK_THEME_HREF = '/assets/css/theme-dark.gen.css';
const DARK_THEME_LINK_ID = 'theme-dark';

/**
 * Applies the shop's colour mode to the page. Dark mode adds the theme's `dark` class to `<html>`
 * and links the dark stylesheet; light mode removes both. The stylesheet is a file of its own so
 * light pages, which is every page while the mode is light, never download it. It runs on the
 * server too, so a dark page arrives with its stylesheet already linked and never flashes light.
 */
export function applyThemeMode(document: Document, mode: string | undefined): void {
	const html = document.documentElement;
	const link = document.getElementById(DARK_THEME_LINK_ID);
	if (mode !== 'dark') {
		html.classList.remove('dark');
		link?.remove();
		return;
	}
	html.classList.add('dark');
	if (link) return;
	const stylesheet = document.createElement('link');
	stylesheet.id = DARK_THEME_LINK_ID;
	stylesheet.rel = 'stylesheet';
	stylesheet.href = DARK_THEME_HREF;
	document.head.appendChild(stylesheet);
}

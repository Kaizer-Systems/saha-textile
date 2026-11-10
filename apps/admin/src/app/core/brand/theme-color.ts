/**
 * The admin's theme colour (Brand Kit › Admin theme colour, owner 2026-11-10). Every theme style
 * reads the CSS variable `--theme-color`; this sets it. The last colour is kept in this browser
 * so the next start paints in it at once instead of flashing the default green.
 */
const STORAGE_KEY = 'st_admin_theme_color';
const HEX = /^#[0-9a-fA-F]{6}$/;

export function applyThemeColor(page: Document, color: string | null | undefined): void {
	if (!color || !HEX.test(color)) return;
	page.documentElement.style.setProperty('--theme-color', color);
	try {
		page.defaultView?.localStorage.setItem(STORAGE_KEY, color);
	} catch {
		// Private windows may refuse storage; the colour still applies for this visit.
	}
}

/** Before the app draws: the colour this browser last saw, if any. */
export function restoreThemeColor(page: Document): void {
	let saved: string | null = null;
	try {
		saved = page.defaultView?.localStorage.getItem(STORAGE_KEY) ?? null;
	} catch {
		return;
	}
	if (saved && HEX.test(saved)) page.documentElement.style.setProperty('--theme-color', saved);
}

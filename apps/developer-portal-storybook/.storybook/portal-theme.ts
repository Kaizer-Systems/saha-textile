/**
 * NEXT-GEN-UI · Storybook theme bridge
 * Storybook's manager API requires a JavaScript theme object. Read the resolved
 * values at runtime so nextgen-theme.css remains the only color, typography,
 * border, and canvas source of truth.
 */

import { create } from 'storybook/theming/create';

function readToken(styles: CSSStyleDeclaration, name: string): string {
	const value = styles.getPropertyValue(name).trim();
	if (!value) {
		throw new Error(`Shared portal theme token ${name} is unavailable.`);
	}
	return value;
}

function readRadius(styles: CSSStyleDeclaration, name: string): number {
	const value = Number.parseFloat(readToken(styles, name));
	if (!Number.isFinite(value)) {
		throw new Error(`Shared portal radius token ${name} is invalid.`);
	}
	return value;
}

export function createPortalStorybookTheme(): ReturnType<typeof create> {
	const styles = window.getComputedStyle(document.documentElement);
	const token = (name: string) => readToken(styles, name);

	return create({
		base: 'dark',
		brandTitle: '⬡ Saha Textile // Component Forge',
		brandUrl: '/',
		colorPrimary: token('--portal-accent'),
		colorSecondary: token('--portal-success'),
		appBg: token('--portal-canvas'),
		appContentBg: token('--portal-surface'),
		appHoverBg: token('--portal-surface-raised'),
		appPreviewBg: token('--portal-canvas'),
		appBorderColor: token('--portal-border'),
		appBorderRadius: readRadius(styles, '--portal-radius-lg'),
		fontBase: token('--portal-font-sans'),
		fontCode: token('--portal-font-mono'),
		textColor: token('--portal-ink'),
		textInverseColor: token('--portal-canvas'),
		textMutedColor: token('--portal-muted'),
		barTextColor: token('--portal-muted'),
		barHoverColor: token('--portal-ink'),
		barSelectedColor: token('--portal-accent'),
		barBg: token('--portal-surface'),
		buttonBg: token('--portal-surface'),
		buttonBorder: token('--portal-border'),
		booleanBg: token('--portal-surface-raised'),
		booleanSelectedBg: token('--portal-accent'),
		inputBg: token('--portal-surface'),
		inputBorder: token('--portal-border'),
		inputTextColor: token('--portal-ink'),
		inputBorderRadius: readRadius(styles, '--portal-radius'),
	});
}

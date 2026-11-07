import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export type PortalTheme = 'light' | 'dark';

function isPortalTheme(value: unknown): value is PortalTheme {
	return value === 'light' || value === 'dark';
}

export const portalThemeDecorator: Decorator = (story, context) => {
	const requestedTheme = context.globals.portalTheme;
	const theme = isPortalTheme(requestedTheme) ? requestedTheme : 'dark';
	document.documentElement.dataset.portalTheme = theme;
	return componentWrapperDecorator(
		(storyMarkup) => `<div data-portal-theme="${theme}" class="portalThemeCanvas">${storyMarkup}</div>`,
	)(story, context);
};

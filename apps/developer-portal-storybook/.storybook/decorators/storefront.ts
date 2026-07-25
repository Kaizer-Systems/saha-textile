import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export const storefrontDecorator: Decorator = componentWrapperDecorator(
	(story) => `<div class="portalThemeCanvas storybookApp storybookApp--storefront">${story}</div>`,
);

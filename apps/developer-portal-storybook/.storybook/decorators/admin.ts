import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export const adminDecorator: Decorator = componentWrapperDecorator(
	(story) => `<div class="portalThemeCanvas storybookApp storybookApp--admin">${story}</div>`,
);

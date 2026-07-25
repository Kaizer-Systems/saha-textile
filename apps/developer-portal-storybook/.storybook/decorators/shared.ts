import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export const sharedDecorator: Decorator = componentWrapperDecorator(
	(story) => `<div class="portalThemeCanvas storybookApp storybookApp--shared">${story}</div>`,
);

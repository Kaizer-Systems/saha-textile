import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export const adminDecorator: Decorator = componentWrapperDecorator(
	(story) => `
		<div class="portalThemeCanvas storybookApp storybookApp--admin">
			<div class="storybookContextHud" aria-hidden="true">
				<span>ADMIN SYSTEM</span><span>ANGULAR RENDERER</span>
			</div>
			<div class="storybookStoryLayer">${story}</div>
		</div>
	`,
);

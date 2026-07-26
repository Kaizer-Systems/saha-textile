import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export const sharedDecorator: Decorator = componentWrapperDecorator(
	(story) => `
		<div class="portalThemeCanvas storybookApp storybookApp--shared">
			<div class="storybookContextHud" aria-hidden="true">
				<span>SHARED CONTRACT</span><span>PORTABLE TOKENS</span>
			</div>
			<div class="storybookStoryLayer">${story}</div>
		</div>
	`,
);

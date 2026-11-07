import { componentWrapperDecorator, type Decorator } from '@storybook/angular';

export const storefrontDecorator: Decorator = componentWrapperDecorator(
	(story) => `
		<div class="portalThemeCanvas storybookApp storybookApp--storefront">
			<div class="storybookContextHud" aria-hidden="true">
				<span>STOREFRONT SYSTEM</span><span>ANGULAR RENDERER</span>
			</div>
			<div class="storybookStoryLayer">${story}</div>
		</div>
	`,
);

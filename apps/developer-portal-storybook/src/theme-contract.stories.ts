import type { Meta, StoryObj } from '@storybook/angular';

const meta = {
	title: 'Shared/Foundation/Theme Contract',
	tags: ['autodocs'],
	parameters: {
		application: 'shared',
	},
	render: () => ({
		template: `
			<section class="storybookThemeSpecimen storybookSpotlight">
				<div>
					<p>Shared developer-portal theme</p>
					<h1>One token source, multiple engineering surfaces</h1>
				</div>
				<p>
					Docusaurus, Angular Storybook, Scalar, TypeDoc, and generated catalogues
					consume the same portable portal tokens. Tool-specific layout remains isolated.
				</p>
				<div class="storybookThemeSpecimen__tokens">
					<div><span class="storybookThemeSpecimen__swatch" style="--swatch: var(--portal-canvas)"></span><code>--portal-canvas</code></div>
					<div><span class="storybookThemeSpecimen__swatch" style="--swatch: var(--portal-surface-raised)"></span><code>--portal-surface-raised</code></div>
					<div><span class="storybookThemeSpecimen__swatch" style="--swatch: var(--portal-accent)"></span><code>--portal-accent</code></div>
					<div><span class="storybookThemeSpecimen__swatch" style="--swatch: var(--portal-success)"></span><code>--portal-success</code></div>
					<div><span class="storybookThemeSpecimen__swatch" style="--swatch: var(--portal-warning)"></span><code>--portal-warning</code></div>
				</div>
			</section>
		`,
	}),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = {};

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { BasicFooter } from '../../../storefront/src/app/layout/footer/basic-footer/basic-footer';
import { About } from '../../../storefront/src/app/layout/footer/widgets/about/about';
import { FooterCategories } from '../../../storefront/src/app/layout/footer/widgets/categories/categories';
import { Contact } from '../../../storefront/src/app/layout/footer/widgets/contact/contact';
import { Copyright } from '../../../storefront/src/app/layout/footer/widgets/copyright/copyright';
import { Links } from '../../../storefront/src/app/layout/footer/widgets/links/links';
import { FooterLogo } from '../../../storefront/src/app/layout/footer/widgets/logo/logo';
import { PaymentOptions } from '../../../storefront/src/app/layout/footer/widgets/payment-options/payment-options';
import { SocialLinks } from '../../../storefront/src/app/layout/footer/widgets/social-links/social-links';

import { siteConfig } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Layout/Footer Surfaces',
	decorators: [
		moduleMetadata({
			imports: [
				BasicFooter,
				About,
				FooterCategories,
				Contact,
				Copyright,
				Links,
				FooterLogo,
				PaymentOptions,
				SocialLinks,
			],
		}),
	],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'A composed review surface made exclusively from the real footer leaf components and the current site-config contract.',
			},
		},
	},
	render: () => ({
		props: {
			data: siteConfig,
			links: siteConfig.footer.useful_link,
		},
		template: `
			<footer class="storybookComponentStage storybookComponentStage--wide storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Footer composition</p>
				<div class="storybookComponentGrid">
					<app-footer-about [data]="data" />
					<app-footer-contact [data]="data" />
					<app-footer-links [links]="links" />
				</div>
				<div class="storybookComponentGrid">
					<app-footer-social-links [data]="data" />
					<app-footer-payment-options />
					<app-footer-copyright [data]="data" />
				</div>
			</footer>
		`,
	}),
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const CurrentConfiguration: Story = {};

export const BrandAndCategories: Story = {
	render: () => ({
		props: { data: siteConfig, footer: { footer_class: 'footer-section-2', footer_logo: '' } },
		template: `
			<footer class="storybookComponentStage storybookComponentStage--wide storybookComponentStage--stack">
				<app-footer-logo [data]="data" [footer]="footer" />
				<app-footer-categories [data]="data" />
			</footer>
		`,
	}),
};

export const CompleteFooter: Story = {
	render: () => ({
		props: { data: siteConfig, footer: { footer_class: 'footer-section-2', footer_logo: '' } },
		template: '<app-basic-footer [data]="data" [footer]="footer" />',
	}),
};

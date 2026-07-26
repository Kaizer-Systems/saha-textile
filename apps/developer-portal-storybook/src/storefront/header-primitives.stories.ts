import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { MinimalHeader } from '../../../storefront/src/app/layout/header/minimal-header/minimal-header';
import { Cart } from '../../../storefront/src/app/layout/header/widgets/cart/cart';
import { Currency } from '../../../storefront/src/app/layout/header/widgets/currency/currency';
import { Language } from '../../../storefront/src/app/layout/header/widgets/language/language';
import { Logo } from '../../../storefront/src/app/layout/header/widgets/logo/logo';
import { MobileMenu } from '../../../storefront/src/app/layout/header/widgets/mobile-menu/mobile-menu';
import { MyAccount } from '../../../storefront/src/app/layout/header/widgets/my-account/my-account';
import { NavbarMenuButton } from '../../../storefront/src/app/layout/header/widgets/navbar-menu-button/navbar-menu-button';
import { Notice } from '../../../storefront/src/app/layout/header/widgets/notice/notice';
import { Search } from '../../../storefront/src/app/layout/header/widgets/search/search';
import { Topbar } from '../../../storefront/src/app/layout/header/widgets/topbar/topbar';
import { Wishlist } from '../../../storefront/src/app/layout/header/widgets/wishlist/wishlist';

import { siteConfig } from '../fixtures/storefront-products';

const meta = {
	title: 'Storefront/Layout/Header Primitives',
	decorators: [
		moduleMetadata({
			imports: [
				MinimalHeader,
				Cart,
				Currency,
				Language,
				Logo,
				MobileMenu,
				MyAccount,
				NavbarMenuButton,
				Notice,
				Search,
				Topbar,
				Wishlist,
			],
		}),
	],
	parameters: {
		application: 'storefront',
	},
	render: () => ({
		props: {
			notices: siteConfig.header.top_bar_content,
		},
		template: `
			<section class="storybookComponentStage storybookComponentStage--stack">
				<p class="storybookComponentStage__label">Navigation trigger</p>
				<app-navbar-menu-button [show]="false" />
				<p class="storybookComponentStage__label">Rotating announcement</p>
				<div style="width: 100%; min-height: 56px">
					<app-notice [content]="notices" />
				</div>
			</section>
		`,
	}),
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const NavigationAndNotice: Story = {};

export const HeaderUtilities: Story = {
	render: () => ({
		props: { data: siteConfig },
		template: `
			<section class="storybookComponentStage storybookComponentStage--wide storybookComponentStage--stack">
				<app-topbar [data]="data" />
				<div class="storybookComponentGrid">
					<app-logo [data]="data" logo="" />
					<app-search style="basic" />
					<app-currency style="basic" />
					<app-language style="basic" />
					<app-my-account style="basic" />
					<app-header-wishlist style="basic" />
					<app-header-cart style="basic" />
				</div>
				<app-mobile-menu />
			</section>
		`,
	}),
};

export const CompleteHeader: Story = {
	render: () => ({
		props: { data: siteConfig },
		template: '<app-minimal-header [data]="data" logo="" [sticky]="true" />',
	}),
};

import { PaymentOption } from '../../../storefront/src/app/features/shop/product-detail/widgets/payment-option/payment-option';
import { ProductAction } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-action/product-action';
import { ProductBanner } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-banner/product-banner';
import { ProductBundle } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-bundle/product-bundle';
import { ProductDeliveryInformation } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-delivery-information/product-delivery-information';
import { ProductDetailsTabs } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-details-tabs/product-details-tabs';
import { ProductInformation } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-information/product-information';
import { ProductReview } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-review/product-review';
import { ProductSocialShare } from '../../../storefront/src/app/features/shop/product-detail/widgets/product-social-share/product-social-share';
import { QuestionsAnswers } from '../../../storefront/src/app/features/shop/product-detail/widgets/questions-answers/questions-answers';
import { SaleTimer } from '../../../storefront/src/app/features/shop/product-detail/widgets/sale-timer/sale-timer';
import { StickyCheckout } from '../../../storefront/src/app/features/shop/product-detail/widgets/sticky-checkout/sticky-checkout';
import { StoreInformation } from '../../../storefront/src/app/features/shop/product-detail/widgets/store-information/store-information';
import { TrendingProducts } from '../../../storefront/src/app/features/shop/product-detail/widgets/trending-products/trending-products';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { simpleProduct, siteConfig, variationProduct } from '../fixtures/storefront-products';

const bundleProduct = {
	...simpleProduct,
	cross_sell_products: [912, 934],
};

const detailImports = [
	PaymentOption,
	ProductAction,
	ProductBanner,
	ProductBundle,
	ProductDeliveryInformation,
	ProductDetailsTabs,
	ProductInformation,
	ProductReview,
	ProductSocialShare,
	QuestionsAnswers,
	SaleTimer,
	StickyCheckout,
	StoreInformation,
	TrendingProducts,
];

const meta = {
	title: 'Storefront/Commerce/Product Detail System',
	component: ProductInformation,
	tags: ['autodocs'],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'The complete reusable product-detail widget system, rendered with repository product and site-configuration fixtures.',
			},
		},
	},
	decorators: [
		moduleMetadata({ imports: detailImports }),
		(story) => {
			const rendered = story();
			return {
				...rendered,
				template: `<div class="storybookComponentStage">${rendered.template ?? ''}</div>`,
			};
		},
	],
	args: { product: simpleProduct },
} satisfies Meta<ProductInformation>;

export default meta;
type Story = StoryObj<ProductInformation>;

export const Information: Story = {};

export const PurchaseAction: Story = {
	render: () => ({
		props: { product: variationProduct },
		template: '<app-product-action [product]="product" />',
	}),
};

export const DeliveryInformation: Story = {
	render: () => ({
		props: { product: simpleProduct },
		template: '<app-product-delivery-information [product]="product" />',
	}),
};

export const PaymentOptions: Story = {
	render: () => ({
		props: { product: simpleProduct, option: siteConfig },
		template: '<app-payment-option [product]="product" [option]="option" />',
	}),
};

export const SocialShare: Story = {
	render: () => ({
		props: { product: simpleProduct, option: siteConfig },
		template: '<app-product-social-share [product]="product" [option]="option" />',
	}),
};

export const Bundle: Story = {
	render: () => ({
		props: { product: bundleProduct },
		template: '<app-product-bundle [product]="product" />',
	}),
};

export const DetailsTabs: Story = {
	render: () => ({
		props: { product: simpleProduct },
		template: '<app-product-details-tabs [product]="product" />',
	}),
};

export const ReviewSummary: Story = {
	render: () => ({
		props: { product: simpleProduct, reviews: [] },
		template: '<app-product-review [product]="product" [reviews]="reviews" />',
	}),
};

export const QuestionsAndAnswers: Story = {
	render: () => ({
		props: { product: simpleProduct, questionAnswers: [] },
		template: '<app-questions-answers [product]="product" [questionAnswers]="questionAnswers" />',
	}),
};

export const SaleCountdown: Story = {
	render: () => ({
		props: {
			startDate: '2026-07-26T00:00:00.000Z',
			endDate: '2027-07-26T00:00:00.000Z',
		},
		template: '<app-sale-timer [startDate]="startDate" [endDate]="endDate" />',
	}),
};

export const StickyCheckoutBar: Story = {
	render: () => ({
		props: { product: simpleProduct },
		template: '<app-sticky-checkout [product]="product" />',
	}),
};

export const PromotionalBanner: Story = {
	render: () => ({
		template: '<app-product-banner image="/assets/images/product.png" />',
	}),
};

export const StoreCard: Story = {
	render: () => ({
		props: { store: null },
		template: '<app-store-information [store]="store" />',
	}),
};

export const TrendingRail: Story = {
	render: () => ({
		template: '<app-trending-products />',
	}),
};

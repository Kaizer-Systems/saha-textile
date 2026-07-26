import type {
	IBundles,
	IDealOfDays,
	IIServices,
	INewsLetter,
	IOffer,
	ISliderProductsTokyo,
} from '../../../storefront/src/app/data-access/interfaces/theme.interface';
import { Banner } from '../../../storefront/src/app/features/themes/widgets/banner/banner';
import { Blog } from '../../../storefront/src/app/features/themes/widgets/blog/blog';
import { Categorie } from '../../../storefront/src/app/features/themes/widgets/categorie/categorie';
import { Collection as ThemeCollection } from '../../../storefront/src/app/features/themes/widgets/collection/collection ';
import { Deal } from '../../../storefront/src/app/features/themes/widgets/deal/deal';
import { FourColumnProduct } from '../../../storefront/src/app/features/themes/widgets/four-column-product/four-column-product';
import { HomeBanner } from '../../../storefront/src/app/features/themes/widgets/home-banner/home-banner';
import { Newsletter } from '../../../storefront/src/app/features/themes/widgets/newsletter/newsletter';
import { Product } from '../../../storefront/src/app/features/themes/widgets/product/product';
import { Service } from '../../../storefront/src/app/features/themes/widgets/service/service';
import { WalletOffer } from '../../../storefront/src/app/features/themes/widgets/wallet-offer/wallet-offer';

import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { simpleProduct } from '../fixtures/storefront-products';

const imageUrl = '/assets/images/product.png';
const banner = {
	image_url: imageUrl,
	status: true,
	redirect_link: { link_type: 'collection', link: 'sarees' },
};
const bundles: IBundles[] = [
	{
		title: 'Heritage Edit',
		sub_title: 'Curated handloom stories',
		button_text: 'Explore',
		image_url: imageUrl,
		status: true,
	},
];
const newsletter: INewsLetter = {
	title: 'Stories from the loom',
	sub_title: 'New collections, craft notes, and studio updates.',
	image_url: imageUrl,
	status: true,
};
const services: IIServices[] = [
	{ title: 'Authentic craft', sub_title: 'Source-led textiles', image_url: imageUrl, status: true },
	{ title: 'Assisted shopping', sub_title: 'Human guidance', image_url: imageUrl, status: true },
	{ title: 'Careful delivery', sub_title: 'Protected worldwide', image_url: imageUrl, status: true },
];
const offers: IOffer[] = [{ coupon_code: 'LOOM10', image_url: imageUrl, status: true }];
const productColumns: ISliderProductsTokyo = {
	status: true,
	product_slider_1: {
		title: 'New arrivals',
		description: 'Recently added',
		product_ids: [901, 912, 934],
		status: true,
	},
};
const deal: IDealOfDays = {
	title: 'Studio selection',
	status: true,
	image_url: imageUrl,
	label: 'Limited',
	deals: [
		{
			offer_title: 'Heritage weave release',
			product_id: simpleProduct.id,
			status: true,
			end_date: '2027-07-26T00:00:00.000Z',
			product: simpleProduct,
		},
	],
};

const meta = {
	title: 'Storefront/Home/Theme Widget Library',
	component: Service,
	tags: ['autodocs'],
	decorators: [
		moduleMetadata({
			imports: [
				Banner,
				Blog,
				Categorie,
				ThemeCollection,
				Deal,
				FourColumnProduct,
				HomeBanner,
				Newsletter,
				Product,
				Service,
				WalletOffer,
			],
		}),
	],
	parameters: {
		application: 'storefront',
		docs: {
			description: {
				component:
					'Every surviving home-page presentation widget from the Angular application, using deterministic local content and the real widget classes.',
			},
		},
	},
	args: { data: services },
} satisfies Meta<Service>;

export default meta;
type Story = StoryObj<Service>;

export const ServiceStrip: Story = {};

export const HorizontalBanner: Story = {
	render: () => ({
		props: { banners: [banner] },
		template: '<app-theme-banner [banners]="banners" style="horizontal" />',
	}),
};

export const HomeHero: Story = {
	render: () => ({
		props: { data: { main_banner: banner, sub_banner_1: banner, sub_banner_2: banner } },
		template: '<app-theme-home-banner theme="paris" [data]="data" />',
	}),
};

export const CategoryRail: Story = {
	render: () => ({
		template: '<app-theme-categorie title="Shop by craft" style="horizontal" />',
	}),
};

export const CollectionRail: Story = {
	render: () => ({
		props: { bundles },
		template: '<app-theme-collection [data]="bundles" />',
	}),
};

export const ProductRail: Story = {
	render: () => ({
		template: '<app-theme-product [productIds]="[901, 912, 934]" style="horizontal" [showItem]="3" />',
	}),
};

export const FourColumnProducts: Story = {
	render: () => ({
		props: { productColumns },
		template: '<app-four-column-product [data]="productColumns" />',
	}),
};

export const DealPanel: Story = {
	render: () => ({
		props: { deal },
		template: '<app-deal [data]="deal" />',
	}),
};

export const NewsletterPanel: Story = {
	render: () => ({
		props: { newsletter },
		template: '<app-newsletter [data]="newsletter" style="classic" />',
	}),
};

export const WalletOfferRail: Story = {
	render: () => ({
		props: { offers },
		template: '<app-wallet-offer [offers]="offers" />',
	}),
};

export const BlogRail: Story = {
	render: () => ({
		template: '<app-blog [blogIds]="[24, 17, 23]" />',
	}),
};

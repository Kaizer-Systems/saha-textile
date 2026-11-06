import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { SiteConfigStore } from '@core/state/site-config.store';
import { WishlistFacade } from '@core/state/wishlist/wishlist.store';
import { BlogCategory } from '@features/blog/sidebar/blog-category/blog-category';
import { BlogTag } from '@features/blog/sidebar/blog-tag/blog-tag';
import { RecentPost } from '@features/blog/sidebar/recent-post/recent-post';
import { SkeletonBlog } from '@features/blog/skeleton-blog/skeleton-blog';
import { CollectionCategories } from '@features/shop/collection/widgets/collection-categories/collection-categories';
import { ProductSidebar } from '@features/shop/product-detail/sidebar/sidebar';
import { PaymentOption } from '@features/shop/product-detail/widgets/payment-option/payment-option';
import { ProductDeliveryInformation } from '@features/shop/product-detail/widgets/product-delivery-information/product-delivery-information';
import { ProductInformation } from '@features/shop/product-detail/widgets/product-information/product-information';
import { ProductReview } from '@features/shop/product-detail/widgets/product-review/product-review';
import { StoreInformation } from '@features/shop/product-detail/widgets/store-information/store-information';
import { YouMayAlsoLike } from '@features/shop/product-detail/you-may-also-like/you-may-also-like';
import { Banner } from '@features/themes/widgets/banner/banner';
import { Collection } from '@features/themes/widgets/collection/collection ';
import { HomeBanner } from '@features/themes/widgets/home-banner/home-banner';
import { Newsletter } from '@features/themes/widgets/newsletter/newsletter';
import { Service } from '@features/themes/widgets/service/service';
import { Footer } from '@layout/footer/footer';
import { About } from '@layout/footer/widgets/about/about';
import { Contact } from '@layout/footer/widgets/contact/contact';
import { Copyright } from '@layout/footer/widgets/copyright/copyright';
import { Links } from '@layout/footer/widgets/links/links';
import { FooterLogo } from '@layout/footer/widgets/logo/logo';
import { SocialLinks } from '@layout/footer/widgets/social-links/social-links';
import { Header } from '@layout/header/header';
import { Logo } from '@layout/header/widgets/logo/logo';
import { Topbar } from '@layout/header/widgets/topbar/topbar';
import { Wishlist } from '@layout/header/widgets/wishlist/wishlist';

import { Breadcrumb } from './breadcrumb/breadcrumb';
import { Loader } from './loader/loader';
import { NoData } from './no-data/no-data';
import { ProductBox } from './product-box/product-box';
import { SkeletonProductBox } from './product-box/skeleton-product-box/skeleton-product-box';
import { AttributesInfo } from './product-config/parts/attributes-info/attributes-info';
import { Title } from './title/title';

/**
 * These components hold inputs and nothing else: what they show lives in their templates, so
 * this proves only that each one can be created. The Playwright run is what proves they render.
 */
const create = <T>(type: Type<T>): T => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [
			{ provide: SiteConfigStore, useValue: { siteConfig: signal(null) } },
			{ provide: WishlistFacade, useValue: { wishlistItems$: of({ data: [], total: 0 }) } },
		],
	});
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type).componentInstance;
};

const widgets: [string, Type<unknown>][] = [
	['About', About],
	['AttributesInfo', AttributesInfo],
	['Banner', Banner],
	['BlogCategory', BlogCategory],
	['BlogTag', BlogTag],
	['Breadcrumb', Breadcrumb],
	['Collection', Collection],
	['CollectionCategories', CollectionCategories],
	['Contact', Contact],
	['Copyright', Copyright],
	['Footer', Footer],
	['FooterLogo', FooterLogo],
	['Header', Header],
	['HomeBanner', HomeBanner],
	['Links', Links],
	['Loader', Loader],
	['Logo', Logo],
	['Newsletter', Newsletter],
	['NoData', NoData],
	['PaymentOption', PaymentOption],
	['ProductBox', ProductBox],
	['ProductDeliveryInformation', ProductDeliveryInformation],
	['ProductInformation', ProductInformation],
	['ProductReview', ProductReview],
	['ProductSidebar', ProductSidebar],
	['RecentPost', RecentPost],
	['Service', Service],
	['SkeletonBlog', SkeletonBlog],
	['SkeletonProductBox', SkeletonProductBox],
	['SocialLinks', SocialLinks],
	['StoreInformation', StoreInformation],
	['Title', Title],
	['Topbar', Topbar],
	['Wishlist', Wishlist],
	['YouMayAlsoLike', YouMayAlsoLike],
];

describe('display-only widgets', () => {
	it.each(widgets)('%s can be created', (_name, type) => {
		expect(create(type)).toBeInstanceOf(type);
	});
});

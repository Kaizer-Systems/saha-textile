import { IPaginateModel } from './core.interface';
import { IProduct } from './product.interface';

export interface IThemesModel extends IPaginateModel {
  data: IThemes[];
}

export interface IThemes {
  id: number;
  name: string;
  slug: string;
  image: string;
  status: number | boolean;
  created_at?: string;
  updated_at?: string;
}

export interface IParis {
  id: number;
  content: IContent;
  slug: string;
}

export interface IContent {
  home_banner: IHomeBanner;
  featured_banners: IFeaturedBanners;
  main_content: IMainContent;
  news_letter: INewsLetter;
  products_ids: number[];
}

export interface IHomeBanner {
  status: boolean;
  main_banner: ILink;
  sub_banner_1: ILink;
  sub_banner_2: ILink;
}

export interface ILink {
  redirect_link: IRedirectLink;
  image_url: string;
}

export interface IRedirectLink {
  link_type: string;
  link: string | number;
}

export interface IFeaturedBanners {
  title?: string;
  status: boolean;
  banners: IBanners[];
}

export interface IBanners {
  redirect_link: IRedirectLink;
  image_url: string;
  status: boolean;
}

export interface IMainContent {
  status: boolean;
  sidebar: ISidebar;
  section1_products: IProductSection;
  section2_categories_list: ICategoriesSection;
  section3_two_column_banners: ITwoBanners;
  section4_products: IProductSection;
  section5_coupons: IFullWidthBanner;
  section6_two_column_banners: ITwoBanners;
  section7_products: IProductSection;
  section8_full_width_banner: IFullWidthBanner;
  section9_featured_blogs: IBlogSection;
}

export interface ISidebar {
  status: boolean;
  categories_icon_list: ICategoriesIconList;
  left_side_banners: ITwoBanners;
  sidebar_products: ISidebarProducts;
}

export interface ICategoriesIconList {
  title: string;
  description?: string;
  category_ids: number[];
  status: boolean;
}

export interface ITwoBanners {
  status: boolean;
  banner_1: ILink;
  banner_2: ILink;
}

export interface ISidebarProducts {
  title: string;
  product_ids: number[];
  status: boolean;
}

export interface IProductSection {
  title: string;
  description?: string;
  product_ids: number[];
  status: boolean;
}

export interface ICategoriesSection {
  title: string;
  description: string;
  image_url: string;
  category_ids: number[];
  status: boolean;
}

export interface IFullWidthBanner {
  redirect_link: IRedirectLink;
  image_url: string;
  status: boolean;
}

export interface IBlogSection {
  title: string;
  description?: string;
  status: boolean;
  blog_ids: number[];
}

export interface INewsLetter {
  title?: string;
  sub_title?: string;
  image_url?: string;
  status?: boolean;
}

//  Tokyo Interface
export interface ITokyo {
  id: number;
  content: IContentTokyo;
  slug: string;
}

export interface IContentTokyo {
  home_banner: IHomeBanner;
  categories_icon_list: ICategoriesIconListTokyo;
  coupons: IFullWidthBanner;
  featured_banners: IFeaturedBanners;
  main_content: IMainContentTokyo;
  full_width_banner: IFullWidthBanner;
  slider_products: ISliderProductsTokyo;
  news_letter: INewsLetter;
  products_ids: number[];
}

export interface ICategoriesIconListTokyo {
  title: string;
  status: boolean;
  image_url: string;
  category_ids: number[];
}

export interface IMainContentTokyo {
  sidebar: ISidebarTokyo;
  section1_products: IProductSection;
  section2_slider_products: IProductSection;
  section3_products: IProductSection;
  section4_products: IProductSection;
}

export interface ISidebarTokyo {
  status: boolean;
  right_side_banners: ITwoBanners;
}

export interface ISliderProductsTokyo {
  status: boolean;
  product_slider_1?: IProductSection;
  product_slider_2?: IProductSection;
  product_slider_3?: IProductSection;
  product_slider_4?: IProductSection;
}

//  Osaka Interface
export interface IOsaka {
  id: number;
  content: IContentOsaka;
  slug: string;
}

export interface IContentOsaka {
  home_banner: IHomeBannerOsaka;
  categories_icon_list: ICategoriesSection;
  coupons: IFullWidthBanner;
  products_list_1: IProductSection;
  offer_banner: IFullWidthBanner;
  products_list_2: IProductSection;
  product_bundles: IProductBundles;
  slider_products: ISliderProductsTokyo;
  featured_blogs: IBlogSection;
  news_letter: INewsLetter;
  products_ids: number[];
}

export interface IHomeBannerOsaka {
  status: boolean;
  main_banner: ILink;
  sub_banner_1: ILink;
}

export interface IProductBundles {
  status: boolean;
  bundles: IBundles[];
}

export interface IBundles {
  title: string;
  sub_title: string;
  button_text: string;
  image_url: string;
  status: boolean;
}

//  Rome Interface
export interface IRome {
  id: number;
  content: IContentRome;
  slug: string;
}

export interface IContentRome {
  home_banner: IHomeBannerRome;
  categories_image_list: ICategoriesIconListTokyo;
  value_banners: IFeaturedBanners;
  categories_products: ICategoriesIconList;
  two_column_banners: ITwoBanners;
  slider_products: ISliderProductsTokyo;
  full_width_banner: IFullWidthBanner;
  products_list_1: IProductSection;
  featured_blogs: IBlogSection;
  news_letter: INewsLetter;
  products_ids: number[];
}

export interface IHomeBannerRome {
  status: boolean;
  bg_image_url: string;
  main_banner: ILink;
  sub_banner_1: ILink;
  sub_banner_2: ILink;
  sub_banner_3: ILink;
}

//  Madrid Interface
export interface IMadrid {
  id: number;
  content: IMadridContent;
  slug: string;
}

export interface IMadridContent {
  home_banner: IHomeBannerMadrid;
  featured_banners: IFeaturedBanners;
  categories_image_list: ICategoriesIconListTokyo;
  products_list_1: IProductSection;
  bank_wallet_offers: IBankWalletOffers;
  product_with_deals: IProductWithDeals;
  full_width_banner: IFullWidthBanner;
  products_list_2: IProductSection;
  products_list_3: IProductSection;
  two_column_banners: ITwoBanners;
  products_list_4: IProductSection;
  products_list_5: IProductSection;
  delivery_banners: ITwoBanners;
  products_list_6: IProductSection;
  products_list_7: IProductSection;
  featured_blogs: IBlogSection;
  products_ids: number[];
}

export interface IHomeBannerMadrid {
  status: boolean;
  main_banner: ILink;
}

export interface IBankWalletOffers {
  title: string;
  status: boolean;
  offers: IOffer[];
}

export interface IOffer {
  coupon_code: string;
  image_url: string;
  status: boolean;
}

export interface IProductWithDeals {
  title: string;
  status: boolean;
  products_list: IProductSection;
  deal_of_days: IDealOfDays;
}

export interface IDealOfDays {
  title: string;
  status: boolean;
  image_url: string;
  label: string;
  deals?: IDeal[];
}

export interface IDeal {
  offer_title: string;
  product_id: number;
  status: boolean;
  end_date: string;
  remainingTime?: IRemainingTime;
  product: IProduct;
}

export interface IRemainingTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface IServicesBanner {
  status: boolean;
  services: IIServices[];
}

export interface IIServices {
  title: string;
  sub_title: string;
  status: boolean;
  image_url: string;
}

//  Berlin Interface
export interface IBerlin {
  id: number;
  content: IBerlinContent;
  slug: string;
}

export interface IBerlinContent {
  home_banner: IHomeBannerOsaka;
  services_banner?: IServicesBanner;
  main_content: IMainContentBerlin;
  full_width_banner: IFullWidthBanner;
  product_list_1: IProductSection;
  news_letter: INewsLetter;
  products_ids: number[];
}

export interface IMainContentBerlin {
  status: boolean;
  sidebar: ISidebarBerlin;
  section1_products: IProductSection;
  section2_categories_icon_list: ICategoriesIconList;
  section3_two_column_banners: ITwoBanners;
  section4_products: IProductSection;
}

export interface ISidebarBerlin {
  status: boolean;
  categories_icon_list: ICategoriesIconList;
  right_side_banners: IRightSideBanners;
  sidebar_products: IProductSection;
}

export interface IRightSideBanners {
  status: boolean;
  banner_1: ILink;
}

//  Denver Interface
export interface IDenver {
  id: number;
  content: IDenverContent;
  slug: string;
}

export interface IDenverContent {
  home_banner: IHomeBannerMadrid;
  categories_icon_list: ICategoriesSection;
  products_list_1: IProductSection;
  two_column_banners: ITwoBanners;
  slider_product_with_banner: ISliderProductWithBanner;
  coupon_banner: IFullWidthBanner;
  products_list_2: IProductSection;
  products_list_3: IProductSection;
  news_letter: INewsLetter;
  products_ids: number[];
}

export interface ISliderProductWithBanner {
  slider_products: ISliderProductsTokyo;
  left_side_banners: IRightSideBanners;
}

export interface IHeaderFooter {
  header_logo?: string;
  footer?: IFooter;
}

export interface IFooter {
  footer_logo?: string;
  footer_class?: string;
}

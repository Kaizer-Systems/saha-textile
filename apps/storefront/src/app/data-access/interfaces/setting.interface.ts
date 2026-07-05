import { IAttachment } from './attachment.interface';
import { ICurrency } from './currency.interface';

export interface ISetting {
  id?: number;
  values: IValues;
}

export interface IValues {
  general: IGeneral;
  activation: IActivation;
  wallet_points: IWalletPoints;
  email: IEmail;
  vendor_commissions: IVendorCommissions;
  refund: IRefund;
  newsletter: INewsletter;
  analytics: IAnalytics;
  delivery: IDelivery;
  google_reCaptcha: IGoogleReCaptcha;
  payment_methods?: IPaymentMethods[];
  maintenance: IMaintenance;
}

export interface ILanguage {
  language: string;
  code: string;
  icon: string;
}

export interface IDayInterval {
  title: string;
  description: string;
}

export interface IGeneral {
  light_logo_image?: IAttachment;
  dark_logo_image?: IAttachment;
  favicon_image?: IAttachment;
  tiny_logo_image?: IAttachment;
  light_logo_image_id?: number;
  dark_logo_image_id?: number;
  tiny_logo_image_id?: number;
  favicon_image_id?: number;
  site_title: string;
  site_tagline: string;
  default_timezone: string;
  default_currency_id: number;
  admin_site_language_direction: string;
  min_order_amount: number;
  min_order_free_shipping: number;
  product_sku_prefix: string;
  default_currency: ICurrency;
  mode: string;
  copyright: string;
}

export interface IActivation {
  multivendor: number | boolean;
  point_enable: number | boolean;
  coupon_enable: number | boolean;
  wallet_enable: number | boolean;
  catalog_enable: number | boolean;
  stock_product_hide: number | boolean;
  store_auto_approve: number | boolean;
  product_auto_approve: number | boolean;
}

export interface IWalletPoints {
  signup_points: number;
  min_per_order_amount: number;
  point_currency_ratio: number;
  reward_per_order_amount: number;
}

export interface IEmail {
  mail_host: string;
  mail_port: number;
  mail_mailer: string;
  mail_password: string;
  mail_username: string;
  mail_encryption: string;
  mail_from_name: string;
  mail_from_address: string;
  mailgun_domain: string;
  mailgun_secret: string;
}

export interface IVendorCommissions {
  status: number;
  min_withdraw_amount: number;
  default_commission_rate: number;
  is_category_based_commission: number;
}

export interface IRefund {
  status: boolean;
  refundable_days: number;
}

export interface INewsletter {
  status: string;
  mailchip_api_key: string;
  mailchip_list_id: string;
}

export interface IAnalytics {
  facebook_pixel: {
    status: number | boolean;
    pixel_id: string;
  };
  google_analytics: {
    status: number | boolean;
    measurement_id: string;
  };
}

export interface IDelivery {
  default_delivery: number | boolean;
  default: IDeliveryDay;
  same_day_delivery: boolean;
  same_day: IDeliveryDay;
  same_day_intervals: IDayInterval[];
}

export interface IDeliveryDay {
  title: ISetting;
  description: string;
}

export interface IDeliveryBlock {
  delivery_description: string | null;
  delivery_interval: string | null;
}

export interface IGoogleReCaptcha {
  secret: string;
  status: number | boolean;
  site_key: string;
}

export interface IPaymentMethods {
  paypal: IPaypal;
  stripe: IStripeAndRazorpay;
  razorpay: IStripeAndRazorpay;
  mollie: IMollie;
  cod: ICOD;
  cash_on_delivery: ICashOnDelivery;
}

export interface ICashOnDelivery {
  status: number | boolean;
}

export interface IPaypal {
  status: number | boolean;
  client_id: string;
  client_secret: string;
  sandbox_mode: string;
}

export interface IStripeAndRazorpay {
  key: string;
  secret: string;
  status: number | boolean;
}

export interface IMollie {
  status: number | boolean;
  secret_key: string;
}

export interface ICOD {
  status: number | boolean;
}

export interface IMaintenance {
  title: string;
  maintenance_mode: boolean;
  maintenance_image_id: number;
  maintenance_image: IAttachment;
  description: string;
}

export interface IPaymentMethods {
  name: string;
  status: boolean;
}

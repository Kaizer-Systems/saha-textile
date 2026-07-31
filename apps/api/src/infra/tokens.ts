/** Dependency-injection tokens binding core-domain ports to infra adapters. */
export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');
export const CURRENCY_REPOSITORY = Symbol('CurrencyRepository');
export const PROMOTION_REPOSITORY = Symbol('PromotionRepository');
export const CART_REPOSITORY = Symbol('CartRepository');
export const ORDER_REPOSITORY = Symbol('OrderRepository');
export const USER_REPOSITORY = Symbol('UserRepository');
export const AUTH_PORT = Symbol('AuthPort');
export const TRANSACTION_MANAGER = Symbol('TransactionManagerPort');

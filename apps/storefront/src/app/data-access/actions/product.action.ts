import { Params } from '@data-access/interfaces/core.interface';

export class GetProductsAction {
  static readonly type = '[Product] Get';
  constructor(public payload?: Params) {}
}

export class GetRelatedProductsAction {
  static readonly type = '[Product] Related Get';
  constructor(public payload?: Params) {}
}

export class GetStoreProductsAction {
  static readonly type = '[Product] Store Get';
  constructor(public payload?: Params) {}
}

export class GetProductBySlugAction {
  static readonly type = '[Product] Get By Slug';
  constructor(public slug: string) {}
}

export class GetDealProductsAction {
  static readonly type = '[Product] Deal Get';
  constructor(public payload?: Params) {}
}

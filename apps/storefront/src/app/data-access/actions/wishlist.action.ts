import { Params } from '@data-access/interfaces/core.interface';

export class GetWishlistAction {
  static readonly type = '[Wishlist] Get';
}

export class AddToWishlistAction {
  static readonly type = '[Wishlist] post';
  constructor(public payload: Params) {}
}

export class DeleteWishlistAction {
  static readonly type = '[Wishlist] delete';
  constructor(public id: number) {}
}

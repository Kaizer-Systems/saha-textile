import { ICartAddOrUpdate } from '@data-access/interfaces/cart.interface';

export class GetCartItemsAction {
  static readonly type = '[Cart] Get';
}

export class AddToCartLocalStorageAction {
  static readonly type = '[Cart] Local Storage Add';
  constructor(public payload: ICartAddOrUpdate) {}
}

export class AddToCartAction {
  static readonly type = '[Cart] Add';
  constructor(public payload: ICartAddOrUpdate) {}
}

export class UpdateCartAction {
  static readonly type = '[Cart] Update';
  constructor(public payload: ICartAddOrUpdate) {}
}

export class ReplaceCartAction {
  static readonly type = '[Cart] Replace';
  constructor(public payload: ICartAddOrUpdate) {}
}

export class DeleteCartAction {
  static readonly type = '[Cart] Delete';
  constructor(public id: number) {}
}

export class CloseStickyCartAction {
  static readonly type = '[Cart] Sticky Close';
  constructor() {}
}

export class ToggleSidebarCartAction {
  static readonly type = '[Cart] Toggle Sidebar';
  constructor(public value: boolean) {}
}

export class ClearCartAction {
  static readonly type = '[Cart] Clear';
  constructor() {}
}

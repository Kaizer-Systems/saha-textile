import { Params } from '@data-access/interfaces/core.interface';

export class GetCompareAction {
  static readonly type = '[Compare] Get';
}

export class AddToCompareAction {
  static readonly type = '[Compare] post';
  constructor(public payload: Params) {}
}

export class DeleteCompareAction {
  static readonly type = '[Compare] delete';
  constructor(public id: number) {}
}

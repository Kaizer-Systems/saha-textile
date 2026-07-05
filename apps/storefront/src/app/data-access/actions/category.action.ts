import { Params } from '@data-access/interfaces/core.interface';

export class GetCategoriesAction {
  static readonly type = '[Category] Get';
  constructor(public payload?: Params) {}
}

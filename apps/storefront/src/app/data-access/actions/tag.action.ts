import { Params } from '@data-access/interfaces/core.interface';

export class GetTagsAction {
  static readonly type = '[Tag] Get';
  constructor(public payload?: Params) {}
}

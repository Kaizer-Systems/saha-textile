import { Params } from '@data-access/interfaces/core.interface';

export class GetReviewAction {
  static readonly type = '[Review] Get';
  constructor(public payload: Params) {}
}

export class SendReviewAction {
  static readonly type = '[Review] Post';
  constructor(public payload: Params) {}
}

export class UpdateReviewAction {
  static readonly type = '[Review] Put';
  constructor(
    public id: number,
    public payload: Params,
  ) {}
}

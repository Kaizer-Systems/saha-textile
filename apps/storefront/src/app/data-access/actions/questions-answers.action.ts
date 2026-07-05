import { Params } from '@data-access/interfaces/core.interface';

export class GetQuestionAnswersAction {
  static readonly type = '[Question] Get';
  constructor(public slug: Params) {}
}

export class SendQuestionAction {
  static readonly type = '[Question] Post';
  constructor(public payload: Params) {}
}

export class UpdateQuestionAnswersAction {
  static readonly type = '[Question] put';
  constructor(
    public payload: Params,
    public id: number,
  ) {}
}

export class FeedbackAction {
  static readonly type = '[Question] Feedback Post';
  constructor(
    public payload: Params,
    public type?: string,
  ) {}
}

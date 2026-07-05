import { Params } from '@data-access/interfaces/core.interface';

export class GetNotificationAction {
  static readonly type = '[Notification] Get';
  constructor(public payload?: Params) {}
}

export class MarkAsReadNotificationAction {
  static readonly type = '[Notification] Mark As Read';
  constructor() {}
}

export class DeleteNotificationAction {
  static readonly type = '[Notification] Delete';
  constructor(public id: string) {}
}

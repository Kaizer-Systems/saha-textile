import { IContactUsModel } from '@data-access/interfaces/page.interface';

export class GetFaqsAction {
  static readonly type = '[Faq] Get';
}

export class ContactUsAction {
  static readonly type = '[ContactUs] Post';
  constructor(public payload: IContactUsModel) {}
}

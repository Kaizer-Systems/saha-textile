import { Params } from '@data-access/interfaces/core.interface';

export class GetAttributesAction {
  static readonly type = '[Attribute] Get';
  constructor(public payload?: Params) {}
}

export class GetAttributeValuesAction {
  static readonly type = '[Attribute] Value Get';
  constructor(public payload?: Params) {}
}

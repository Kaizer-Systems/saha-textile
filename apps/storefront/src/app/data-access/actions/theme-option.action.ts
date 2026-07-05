export class GetThemeOptionAction {
  static readonly type = '[Theme Option] Get';
}

export class UpdateSessionAction {
  static readonly type = '[Theme Option] Update Session';
  constructor(
    public slug: string,
    public value: boolean,
  ) {}
}

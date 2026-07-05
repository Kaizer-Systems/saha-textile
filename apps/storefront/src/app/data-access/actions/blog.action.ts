import { Params } from '@data-access/interfaces/core.interface';

export class GetBlogsAction {
  static readonly type = '[Blog] Get';
  constructor(public payload?: Params) {}
}

export class GetBlogBySlugAction {
  static readonly type = '[Blog] By Slug';
  constructor(public slug: string) {}
}

export class GetRecentBlogAction {
  static readonly type = '[Blog] By Recent';
  constructor(public payload?: Params) {}
}

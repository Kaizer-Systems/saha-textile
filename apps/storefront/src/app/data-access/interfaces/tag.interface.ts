import { IPaginateModel } from './core.interface';

export interface ITagModel extends IPaginateModel {
  data: ITag[];
}

export interface ITag {
  id: number;
  name: string;
  slug: string;
  description?: string;
  type: string;
  status: boolean;
  created_by_id: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

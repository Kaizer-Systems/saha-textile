import { IAttachment } from './attachment.interface';
import { IPaginateModel } from './core.interface';

export interface IAttributeModel extends IPaginateModel {
  data: IAttribute[];
}

export interface IAttributeValueModel extends IPaginateModel {
  data: IAttributeValue[];
}

export interface IAttribute {
  id: number;
  name: string;
  slug: string;
  status: boolean;
  style: string;
  attribute_values: IAttributeValue[];
  selected_value: string;
  created_by_id: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface IAttributeValue {
  id: number;
  name: string;
  value: string;
  slug: string;
  status: boolean;
  hex_color: string;
  attribute_id: number;
  variation_image?: IAttachment;
  stock_status?: string;
  created_by_id?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

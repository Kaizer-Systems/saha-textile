import { IPaginateModel } from './core.interface';

export interface INotificationModel extends IPaginateModel {
  data: INotification[];
}

export interface INotification {
  id: string;
  type: string;
  notifiable_type: string;
  notifiable_id: number;
  data: IData;
  read_at?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface IData {
  title: string;
  message: string;
  type: string;
}

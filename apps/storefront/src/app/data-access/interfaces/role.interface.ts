export interface IRole {
  id: number;
  name: string;
  guard_name?: string;
  created_at?: string;
  updated_at?: string;
  permissions?: IPermission[];
}

export interface IModule {
  id: number;
  name: string;
  isChecked: boolean;
  created_at?: string;
  updated_at?: string;
  module_permissions: IPermission[];
}

export interface IPermission {
  id: number;
  permission_id: number;
  name: string;
  isChecked?: boolean;
  guard_name?: string;
  created_at?: string;
  updated_at?: string;
}

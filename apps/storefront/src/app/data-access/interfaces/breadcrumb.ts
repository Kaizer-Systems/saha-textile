export interface IBreadcrumb {
  title: string;
  items: IItem[];
}

export interface IItem {
  label: string;
  url?: string;
  active?: boolean;
}

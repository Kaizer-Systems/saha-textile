export interface IWallet {
  id: number;
  consumer_id: number;
  balance: number;
  transactions: ITransactions;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface ITransactions {
  current_page: number;
  data: ITransactionsData[];
  first_page_url: string;
  from: string;
  last_page: number;
  last_page_url: string;
  links: [];
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number;
  total: number;
}

export interface ITransactionsData {
  id?: number;
  wallet_id: number;
  order_id: number;
  point_id: number;
  amount: number;
  type: string;
  type_status: string;
  detail: string;
  from: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

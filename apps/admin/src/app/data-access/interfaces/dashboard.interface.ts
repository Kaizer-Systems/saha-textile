export interface IStatisticsCount {
	total_revenue: number;
	total_orders: number;
	total_users: number;
	total_products: number;
	total_stores: number;
	total_refunds: number;
	total_withdraw_requests: number;
}

export interface IRevenueChart {
	revenues: number[];
	commissions: number[];
	months: string[];
}

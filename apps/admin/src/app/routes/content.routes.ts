import { Routes } from '@angular/router';

export const content: Routes = [
	{
		path: 'dashboard',
		loadChildren: () => import('@features/dashboard/dashboard.routes'),
	},
	{
		path: 'account',
		loadChildren: () => import('@features/account/account.routes'),
	},
	{
		path: 'role',
		loadChildren: () => import('@features/role/role.routes'),
	},
	{
		path: 'user',
		loadChildren: () => import('@features/user/user.routes'),
	},
	{
		path: 'customer',
		loadChildren: () => import('@features/customer/customer.routes'),
	},
	{
		path: 'attribute',
		loadChildren: () => import('@features/attribute/attribute.routes'),
	},
	{
		path: 'tag',
		loadChildren: () => import('@features/tag/tag.routes'),
	},
	{
		path: 'blog',
		loadChildren: () => import('@features/blog/blog.routes'),
	},
	{
		path: 'page',
		loadChildren: () => import('@features/page/page.routes'),
	},
	{
		path: 'tax',
		loadChildren: () => import('@features/tax/tax.routes'),
	},
	{
		path: 'store',
		loadChildren: () => import('@features/store/store.routes'),
	},
	{
		path: 'category',
		loadChildren: () => import('@features/category/category.routes'),
	},
	{
		path: 'shipping',
		loadChildren: () => import('@features/shipping/shipping.routes'),
	},
	{
		path: 'media',
		loadChildren: () => import('@features/media/media.routes'),
	},
	{
		path: 'coupon',
		loadChildren: () => import('@features/coupon/coupon.routes'),
	},
	{
		path: 'product',
		loadChildren: () => import('@features/product/product.routes'),
	},
	{
		path: 'currency',
		loadChildren: () => import('@features/currency/currency.routes'),
	},
	{
		path: 'customer-ledger',
		loadChildren: () => import('@features/customer-ledger/customer-ledger.routes'),
	},
	{
		path: 'point',
		loadChildren: () => import('@features/point/point.routes'),
	},
	{
		path: 'setting',
		loadChildren: () => import('@features/setting/setting.routes'),
	},
	{
		path: 'order-status',
		loadChildren: () => import('@features/order-status/order-status.routes'),
	},
	{
		path: 'order',
		loadChildren: () => import('@features/order/order.routes'),
	},
	{
		path: 'theme-option',
		loadChildren: () => import('@features/theme-option/theme-option.routes'),
	},
	{
		path: 'review',
		loadChildren: () => import('@features/review/review.routes'),
	},
	{
		path: 'faq',
		loadChildren: () => import('@features/faq/faq.routes'),
	},
	{
		path: 'notification',
		loadChildren: () => import('@features/notification/notification.routes'),
	},
	{
		path: 'refund',
		loadChildren: () => import('@features/refund/refund.routes'),
	},
	{
		path: 'qna',
		loadChildren: () => import('@features/questions-answers/questions-answers.routes'),
	},
];

import { IMenu } from '@data-access/interfaces/menu.interface';

export const menu: IMenu[] = [
	{
		id: 1,
		title: 'home',
		type: 'link',
		path: '/',
		active: false,
	},
	{
		id: 3,
		title: 'product',
		type: 'sub',
		megaMenu: true,
		megaMenuType: 'link',
		slider: 'banner_portrait',
		active: false,
		children: [
			{
				children: [
					{
						title: 'product_pages',
						type: 'sub',
					},
					{
						title: 'product_thumbnail',
						path: 'product/deliciously-sweet-watermelon',
						params: { layout: 'product_thumbnail' },
						type: 'link',
					},
					{
						title: 'product_images',
						path: 'product/deliciously-sweet-watermelon',
						params: { layout: 'product_images' },
						type: 'link',
					},
					{
						title: 'product_slider',
						path: 'product/deliciously-sweet-watermelon',
						params: { layout: 'product_slider' },
						type: 'link',
					},
					{
						title: 'product_sticky',
						type: 'link',
						path: 'product/deliciously-sweet-watermelon',
						params: { layout: 'product_sticky' },
						labelClass: 'warning-label',
					},
					{
						title: 'product_accordion',
						path: 'product/deliciously-sweet-watermelon',
						params: { layout: 'product_accordion' },
						type: 'link',
					},
					{
						title: 'product_tab',
						path: 'product/deliciously-sweet-watermelon',
						type: 'link',
					},
					{
						title: 'product_features',
						type: 'sub',
						class: 'custom-mt',
					},
					{
						title: 'bundle_cross_sale',
						path: 'product/high-quality-bookshelves',
						type: 'link',
					},
					{
						title: 'hot_stock_progress',
						path: 'product/mini-bodycon-dress',
						type: 'link',
						label: 'new',
					},
					{
						title: 'sold_out',
						path: 'product/solid-collared-tshirts',
						type: 'link',
					},
					{
						title: 'sale_countdown',
						path: 'product/men-gym-co-ord-set',
						type: 'link',
					},
					{
						title: 'product_zoom',
						path: 'product/deliciously-sweet-watermelon',
						type: 'link',
					},
				],
			},
			{
				children: [
					{
						title: 'product_variants_style',
						type: 'sub',
					},
					{
						title: 'variant_rectangle',
						path: 'product/organic-oranges',
						type: 'link',
					},
					{
						title: 'variant_circle',
						type: 'link',
						path: 'product/solid-hooded-sweatshirt',
						label: 'new',
					},
					{
						title: 'variant_image_swatch',
						path: 'product/relaxed-fit-hoodie',
						type: 'link',
					},
					{
						title: 'variant_color',
						path: 'product/premium-blazer',
						type: 'link',
					},
					{
						title: 'variant_radio_button',
						path: 'product/women-flared-jeans',
						type: 'link',
					},
					{
						title: 'variant_dropdown',
						path: 'product/fresh-and-pure-oil',
						type: 'link',
					},
					{
						title: 'product_features',
						type: 'sub',
						class: 'custom-mt',
					},
					{
						title: 'sticky_checkout',
						path: 'product/elegant-and-durable-bed',
						type: 'link',
					},
					{
						title: 'dynamic_checkout',
						type: 'link',
						path: 'product/solid-polo-tshirt',
						labelClass: 'warning-label',
					},
					{
						title: 'secure_checkout',
						path: 'product/premium-dumbbells',
						type: 'link',
					},
					{
						title: 'active_product_view',
						path: 'product/organic-long-grain-rice',
						type: 'link',
					},
					{
						title: 'active_last_orders',
						path: 'product/delicious-cupcakes',
						type: 'link',
					},
				],
			},
			{
				children: [
					{
						title: 'product_features',
						type: 'sub',
					},
					{
						title: 'product_simple',
						path: 'product/deliciously-sweet-strawberry',
						type: 'link',
					},
					{
						title: 'product_classified',
						path: 'product/deliciously-sweet-watermelon',
						type: 'link',
						label: 'new',
					},
					{
						title: 'size_chart',
						type: 'link',
						path: 'product/solid-hooded-sweatshirt',
						label: 'new',
					},
					{
						title: 'delivery_return',
						path: 'product/relaxed-fit-hoodie',
						type: 'link',
					},
					{
						title: 'product_review',
						path: 'product/deliciously-sweet-watermelon',
						type: 'link',
					},
					{
						title: 'ask_an_expert',
						path: 'product/premium-blazer',
						type: 'link',
					},
					{
						title: 'product_features',
						type: 'sub',
						class: 'custom-mt',
					},
					{
						title: 'product_tags',
						path: 'product/solid-hooded-sweatshirt',
						type: 'link',
					},
					{
						title: 'product_information',
						path: 'product/solid-cotton-tshirts',
						type: 'link',
					},
					{
						title: 'social_share',
						type: 'link',
						path: 'product/pointed-toe-kitten-heeled-sandals',
						label: 'hot',
						labelClass: 'warning-label',
					},
					{
						title: 'related_products',
						type: 'link',
						path: 'product/delicious-biscuits',
						label: 'hot',
						labelClass: 'warning-label',
					},
					{
						title: 'wishlist_compare',
						path: 'product/crispy-potato-chips',
						type: 'link',
					},
				],
			},
		],
	},
	{
		id: 2,
		title: 'mega_menu',
		type: 'sub',
		badge: 'new',
		megaMenu: true,
		megaMenuType: 'link',
		path: 'collections',
		active: false,
		slider: 'banner_landscape',
		children: [
			{
				children: [
					{
						title: 'popular_categories',
						type: 'sub',
					},
					{
						title: 'vegetables_fruits',
						type: 'link',
						path: 'collections',
						params: { category: 'vegetables-fruits' },
					},
					{
						title: 'biscuits_snacks',
						type: 'link',
						label: 'new',
						path: 'collections',
						params: { category: 'biscuits-snacks' },
					},
					{
						title: 'daily_breakfast',
						type: 'link',
						label: 'new',
						path: 'collections',
						params: { category: 'daily-breakfast' },
					},
					{
						title: 'trendy_fashion',
						type: 'link',
						path: 'collections',
						params: { category: 'fashion' },
					},
					{
						title: 'furniture_decore',
						type: 'link',
						path: 'collections',
						params: { category: 'furniture' },
					},
				],
			},
			{
				children: [
					{
						title: 'popular_tags',
						type: 'sub',
					},
					{
						title: 'beauty_products',
						type: 'link',
						path: 'collections',
						params: { tag: 'beauty' },
					},
					{
						title: 'electronics_accessories',
						type: 'link',
						label: 'hot',
						labelClass: 'warning-label',
						path: 'collections',
						params: { tag: 'electronics' },
					},
					{
						title: 'pet_shop',
						type: 'link',
						path: 'collections',
						params: { tag: 'pet-shop' },
					},
					{
						title: 'milk_dairy_products',
						type: 'link',
						path: 'collections',
						params: { tag: 'milk-dairy-products' },
					},
					{
						title: 'sports',
						type: 'link',
						path: 'collections',
						params: { tag: 'sports' },
					},
				],
			},
			{
				children: [
					{
						title: 'email_template',
						type: 'sub',
					},
					{
						title: 'welcome_template',
						type: 'external_link',
						path: 'https://themes.pixelstrap.com/fastkart/email-templete/welcome.html',
					},
					{
						title: 'abondonment',
						type: 'external_link',
						label: 'hot',
						labelClass: 'warning-label',
						path: 'https://themes.pixelstrap.com/fastkart/email-templete/abandonment-email.html',
					},
					{
						title: 'offer_template',
						type: 'external_link',
						path: 'https://themes.pixelstrap.com/fastkart/email-templete/offer-template.html',
					},
					{
						title: 'order_success',
						type: 'external_link',
						label: 'new',
						path: 'https://themes.pixelstrap.com/fastkart/email-templete/order-success.html',
					},
					{
						title: 'reset_password',
						type: 'external_link',
						path: 'https://themes.pixelstrap.com/fastkart/email-templete/reset-password.html',
					},
				],
			},
			{
				children: [
					{
						title: 'invoice_template',
						type: 'sub',
					},
					{
						title: 'invoice_template_1',
						type: 'external_link',
						path: 'https://themes.pixelstrap.com/fastkart/invoice/invoice-1.html',
					},
					{
						title: 'invoice_template_2',
						type: 'external_link',
						label: 'hot',
						path: 'https://themes.pixelstrap.com/fastkart/invoice/invoice-2.html',
					},
					{
						title: 'invoice_template_3',
						type: 'external_link',
						path: 'https://themes.pixelstrap.com/fastkart/invoice/invoice-3.html',
					},
				],
			},
		],
	},
	{
		id: 4,
		title: 'blog',
		type: 'sub',
		megaMenu: true,
		megaMenuType: 'link',
		slider: 'blog',
		active: false,
		children: [
			{
				children: [
					{
						title: 'blog_pages',
						type: 'sub',
					},
					{
						title: 'blog_list',
						type: 'link',
						path: 'blogs',
						params: { style: 'list_view', sidebar: 'left_sidebar' },
						label: 'new',
					},
					{
						title: 'grid_left_sidebar',
						type: 'link',
						label: 'hot',
						path: 'blogs',
						params: { style: 'grid_view', sidebar: 'left_sidebar' },
						labelClass: 'warning-label',
					},
					{
						title: 'grid_right_sidebar',
						type: 'link',
						path: 'blogs',
						params: { style: 'grid_view', sidebar: 'right_sidebar' },
					},
					{
						title: 'grid_no_sidebar',
						type: 'link',
						path: 'blogs',
						params: { style: 'grid_view', sidebar: 'no_sidebar' },
					},
					{
						title: 'blog_details',
						path: 'blog/supercharge-your-meals-incorporating-colorful-vegetables-and-fruits',
						type: 'link',
					},
				],
			},
		],
	},
	{
		id: 5,
		title: 'pages',
		active: false,
		type: 'sub',
		children: [
			{
				title: 'authentication',
				type: 'sub',
				children: [
					{
						title: 'sign_in',
						path: 'auth/login',
						type: 'link',
					},
					{
						title: 'sign_up',
						path: 'auth/register',
						type: 'link',
					},
					{
						title: 'forgot_password',
						path: 'auth/forgot-password',
						type: 'link',
					},
					{
						title: 'verify_otp',
						path: 'auth/otp',
						type: 'link',
					},
					{
						title: 'update_password',
						path: 'auth/update-password',
						type: 'link',
					},
				],
			},
			{
				title: 'account',
				type: 'sub',
				children: [
					{
						title: 'my_dashboard',
						path: 'account/dashboard',
						type: 'link',
					},
					{
						title: 'my_notifications',
						path: 'account/notifications',
						type: 'link',
					},
					{
						title: 'my_addresses',
						path: 'account/addresses',
						type: 'link',
					},
					{
						title: 'my_wallet',
						path: 'account/wallet',
						type: 'link',
					},
					{
						title: 'my_points',
						path: 'account/point',
						type: 'link',
					},
					{
						title: 'my_orders',
						path: 'account/order',
						type: 'link',
					},
					{
						title: 'order_details',
						path: 'account/order/details/1000',
						type: 'link',
					},
					{
						title: 'refund_history',
						path: 'account/refund',
						type: 'link',
					},
					{
						title: 'payout_details',
						path: 'account/bank-details',
						type: 'link',
					},
				],
			},
			{
				title: 'about_us',
				type: 'link',
				path: 'about-us',
			},
			{
				title: 'browse_faqs',
				type: 'link',
				path: 'faq',
				label: 'hot',
				labelClass: 'warning-label',
			},
			{
				title: 'cart',
				type: 'link',
				path: 'cart',
			},
			{
				title: 'checkout',
				type: 'link',
				path: 'checkout',
			},
			{
				title: 'compare',
				type: 'link',
				path: 'compare',
			},
			{
				title: 'contact_us',
				path: 'contact-us',
				type: 'link',
			},
			{
				title: 'maintenance',
				type: 'link',
				path: 'maintenance',
			},
			{
				title: 'offers',
				type: 'link',
				path: 'offer',
				label: 'new',
			},
			{
				title: 'search',
				type: 'link',
				path: 'search',
				label: 'hot',
				labelClass: 'warning-label',
			},
			{
				title: 'wishlist',
				type: 'link',
				path: 'wishlist',
			},
			{
				title: '404',
				type: 'link',
				path: '404',
			},
		],
	},
];

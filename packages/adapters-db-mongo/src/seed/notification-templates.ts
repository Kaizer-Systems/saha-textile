import type { NotificationTemplate } from '@saha-textile/contracts';

/**
 * Transactional email templates the catalogue sends. An MSG91 email template's name must equal
 * its key exactly. The sender passes ids and words only; the template builds its own links, so
 * the API never holds a hostname.
 */
export const CATALOG_NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
	{
		id: 'tpl_back_in_stock',
		key: 'back_in_stock',
		channel: 'email',
		category: 'transactional',
		name: 'Back in stock',
		description: 'Variables: productSlug, productName, variantSku.',
		dltHeaderId: null,
		dltTemplateId: null,
		whatsappTemplateId: null,
		emailSubject: { en: '##productName## is back in stock', bn: '##productName## আবার স্টকে এসেছে' },
		emailBody: {
			en: 'Good news: ##productName## can be bought again.',
			bn: 'সুখবর: ##productName## আবার কেনা যাচ্ছে।',
		},
		status: 'approved',
	},
	{
		id: 'tpl_product_question_answered',
		key: 'product_question_answered',
		channel: 'email',
		category: 'transactional',
		name: 'Product question answered',
		description: 'Variables: questionId, productSlug.',
		dltHeaderId: null,
		dltTemplateId: null,
		whatsappTemplateId: null,
		emailSubject: { en: 'Your question has an answer', bn: 'আপনার প্রশ্নের উত্তর দেওয়া হয়েছে' },
		emailBody: {
			en: 'We have answered the question you asked about a product.',
			bn: 'একটি পণ্য নিয়ে আপনার করা প্রশ্নের উত্তর আমরা দিয়েছি।',
		},
		status: 'approved',
	},
];

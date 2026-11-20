// The 24 Saha Textile email templates (22 from the message-templates document + 2 new: order_payment_link and
// payment_receipt). Each has: name (registered as <name>_v1), subject, preheader, group, the variables our
// server sends, the body, and sample values used only for the brief's previews.
import { layout, h1, p, small, code, panel, rows, items, totals, button, C } from './layout.mjs';

const A = (href, t) => `<a href="${href}" style="color:${C.brand};text-decoration:underline">${t}</a>`;
const IMG = (n) => `[[preview_assets]]/p${n}.jpg`;
const ITEMS = [
	{
		image: IMG(1),
		name: 'Red Banarasi Katan Silk Saree',
		options: 'Colour: Red · With blouse piece',
		quantity: '2',
		price: '₹10,200',
		total: '₹20,400',
		note: '',
	},
	{
		image: IMG(3),
		name: 'Bengal Cotton Tant Saree',
		options: '',
		quantity: '1',
		price: '₹2,450',
		total: '₹2,450',
		note: '',
	},
];
const ORDER = { order_number: 'ST-48188-30422', order_url: '[[shop_origin]]/account/orders/ST-48188-30422' };

const otp = (name, subject, heading, lead) => ({
	name,
	group: 'Account',
	subject,
	preheader: 'Your code is inside. It works for 10 minutes.',
	variables: { code: '6-digit code' },
	body:
		h1(heading) +
		p(lead) +
		code('{{code}}') +
		p('It works for 10 minutes. Never share it: Saha Textile staff will never ask you for it.') +
		small('If you didn’t ask for this code, you can ignore this email; nothing changes without it.'),
	sample: { code: '482913' },
});

export const TEMPLATES = [
	otp(
		'otp_register',
		'Your Saha Textile sign-up code',
		'Finish signing up',
		'Use this code to finish creating your Saha Textile account:',
	),
	otp(
		'otp_login',
		'Your Saha Textile sign-in code',
		'Your sign-in code',
		'Use this code to sign in to Saha Textile:',
	),
	otp(
		'otp_step_up',
		'Confirm it is you: your Saha Textile code',
		'Confirm it’s you',
		'You’re changing something important on your account. Use this code to confirm it’s you:',
	),
	otp(
		'otp_change_contact',
		'Confirm your new email address',
		'Confirm your new email address',
		'This address was added to a Saha Textile account. Use this code to confirm it:',
	),
	{
		name: 'contact_change_requested',
		group: 'Account',
		subject: 'A change was requested on your Saha Textile account',
		preheader: 'If this wasn’t you, tell us straight away.',
		variables: { field: 'what is changing, e.g. “mobile number”', masked_value: 'the new value, partly hidden' },
		body:
			h1('A change was requested on your account') +
			p('Someone asked to change the {{field}} on your Saha Textile account to {{masked_value}}.') +
			panel(
				'<b>Was this you?</b> Then there’s nothing to do. If it wasn’t, reply to this email or call us straight away and we’ll stop the change.',
				'warn',
			) +
			small('We send this to your current details so a change can never happen without you knowing.'),
		sample: { field: 'mobile number', masked_value: '•••• •• 4417' },
	},
	{
		name: 'customer_activation',
		group: 'Account',
		subject: 'Activate your Saha Textile account',
		preheader: 'Our team created an account for you. Set your password to start.',
		variables: { name: 'first name', token: 'activation token' },
		body:
			h1('Welcome, {{name}}') +
			p(
				'Our team created a Saha Textile account for you, so you can follow your orders and shop faster. Set a password to activate it.',
			) +
			button('[[shop_origin]]/auth/activate?token={{token}}', 'Activate my account') +
			small(
				'The link works for 48 hours. If you weren’t expecting this, ignore it and the account stays inactive.',
			),
		sample: { name: 'Kavita', token: 'x' },
	},
	{
		name: 'password_reset',
		group: 'Account',
		subject: 'Reset your Saha Textile password',
		preheader: 'The link works for 30 minutes.',
		variables: { token: 'reset token' },
		body:
			h1('Reset your password') +
			p('We got a request to reset the password on your Saha Textile account.') +
			button('[[shop_origin]]/auth/update-password?token={{token}}', 'Choose a new password') +
			small(
				'The link works for 30 minutes. If you didn’t ask for this, ignore this email; your password stays the same.',
			),
		sample: { token: 'x' },
	},
	{
		name: 'verify_email',
		group: 'Account',
		subject: 'Verify your email address for Saha Textile',
		preheader: 'One click and you’re done.',
		variables: { token: 'verification token' },
		body:
			h1('Verify your email address') +
			p('Please confirm this is your email address, so order updates reach you.') +
			button('[[shop_origin]]/auth/verify-email?token={{token}}', 'Verify my email') +
			small('The link works for 24 hours.'),
		sample: { token: 'x' },
	},
	{
		name: 'admin_invite',
		group: 'Account',
		subject: 'You are invited to the Saha Textile admin',
		preheader: 'Accept within 7 days.',
		variables: { token: 'invitation token', role: 'role name' },
		body:
			h1('You’re invited to the Saha Textile admin') +
			p('You’ve been invited to join the Saha Textile team as <b>{{role}}</b>.') +
			button('[[admin_origin]]/auth/accept-invite?token={{token}}', 'Accept the invitation') +
			small('The invitation works for 7 days. If you weren’t expecting it, ignore this email.'),
		sample: { token: 'x', role: 'Store manager' },
	},
	{
		name: 'order_confirmed',
		group: 'Orders',
		subject: 'Your Saha Textile order {{order_number}} is confirmed',
		preheader: 'Thank you! Here’s everything you ordered.',
		variables: {
			order_number: 'order number',
			order_date: 'date',
			items: 'each item: image, name, options, quantity, price, total, note',
			subtotal: 'formatted',
			shipping: 'formatted',
			shipping_note: 'why that shipping charge',
			gst_note: 'e.g. “Included”',
			total: 'formatted, in the paid currency',
			payment_line: 'how it was or will be paid',
			delivery_address: 'one line',
			order_url: 'link to the order page',
			has_cancel_note: 'true when some items can’t be cancelled once work starts',
		},
		body:
			h1('Thank you for your order') +
			p('Order <b>{{order_number}}</b> · {{order_date}}. We’ll email you again when it ships.') +
			items() +
			totals([
				['Subtotal', '{{subtotal}}'],
				['Shipping<br><span style="font-size:12px;color:#5f6b76">{{shipping_note}}</span>', '{{shipping}}'],
				['GST', '{{gst_note}}'],
				['Total', '{{total}}', true],
			]) +
			panel(
				rows([
					['Payment', '{{payment_line}}'],
					['Delivering to', '{{delivery_address}}'],
				]),
			) +
			'{{#if has_cancel_note}}' +
			small('Made-to-order and stitched pieces can’t be cancelled once we start working on them.') +
			'{{/if}}' +
			button('{{order_url}}', 'View your order'),
		sample: {
			...ORDER,
			order_date: '18 Nov 2026',
			items: ITEMS,
			subtotal: '₹22,850',
			shipping: '₹200',
			shipping_note: '2 discounted pieces × ₹100; full-price pieces ship free',
			gst_note: 'Included',
			total: '₹23,050',
			payment_line: 'Paid ₹23,050 by card',
			delivery_address: 'Rina Das, 3 Southern Avenue, Kolkata 700029',
			has_cancel_note: false,
		},
	},
	{
		name: 'order_payment_link',
		group: 'Orders',
		isNew: true,
		subject: 'Pay for your Saha Textile order {{order_number}}',
		preheader: 'Your order is ready. Pay securely with the link inside.',
		variables: {
			name: 'first name',
			order_number: 'order number',
			items: 'as in order_confirmed',
			subtotal: 'formatted',
			shipping: 'formatted',
			total: 'formatted, in the order currency',
			pays_by: 'e.g. “card, UPI or net banking” or “PayPal balance or card”',
			pay_url: 'our pay page (sahatextile.com/pay/…)',
			valid_until: 'date and time',
		},
		body:
			h1('Your order is ready to pay') +
			p(
				'Hello {{name}}, here is the order we put together for you. Pay with {{pays_by}} using the button below.',
			) +
			items() +
			totals([
				['Subtotal', '{{subtotal}}'],
				['Shipping', '{{shipping}}'],
				['Total to pay', '{{total}}', true],
			]) +
			button('{{pay_url}}', 'Pay {{total}}') +
			small(
				'The link works until {{valid_until}}, and the price stays as shown until then. It opens our own page at sahatextile.com; we never ask for card details by email.',
			),
		sample: {
			name: 'Kavita',
			order_number: 'ST-48226-91342',
			items: [
				{
					image: IMG(2),
					name: 'Blush Pink Georgette Saree',
					options: '',
					quantity: '1',
					price: '₹6,800',
					total: '₹6,800',
				},
				{
					image: IMG(1),
					name: 'Maroon Temple Border Silk',
					options: 'MRP ₹9,800',
					quantity: '1',
					price: '₹8,900',
					total: '₹8,900',
				},
			],
			subtotal: '₹15,700',
			shipping: '₹100',
			total: '₹15,800',
			pays_by: 'card, UPI or net banking',
			pay_url: '#',
			valid_until: '27 Nov, 3:02 pm',
		},
	},
	{
		name: 'payment_not_completed',
		group: 'Orders',
		subject: 'Your payment for order {{order_number}} did not go through',
		preheader: 'Your order isn’t confirmed yet. You can try again.',
		variables: { order_number: 'order number', retry_url: 'link back to pay' },
		body:
			h1('Your payment didn’t go through') +
			p(
				'The payment for order <b>{{order_number}}</b> wasn’t completed, so the order isn’t confirmed yet and the pieces aren’t held.',
			) +
			p('If your bank took any money, it returns it automatically.') +
			button('{{retry_url}}', 'Try again'),
		sample: { order_number: 'ST-48215-40330', retry_url: '#' },
	},
	{
		name: 'order_on_backorder',
		group: 'Orders',
		subject: 'An item in your order {{order_number}} is on backorder',
		preheader: 'Here’s when it will be sent, and how to cancel it free.',
		variables: {
			order_number: 'order number',
			items: 'the backordered items',
			dispatch_date: 'expected dispatch date',
			order_url: 'link to the order page',
		},
		body:
			h1('An item is on backorder') +
			p('Thank you for order <b>{{order_number}}</b>. This piece is being made or restocked for you:') +
			items() +
			panel(
				rows([
					['Expected dispatch', '<b>{{dispatch_date}}</b>'],
					['Changed your mind?', 'You can cancel it free until it is packed.'],
				]),
			) +
			button('{{order_url}}', 'View or cancel'),
		sample: { ...ORDER, items: [ITEMS[0]], dispatch_date: '5 Dec 2026' },
	},
	{
		name: 'order_refunded_sold_out',
		group: 'Orders',
		subject: 'Sorry, an item in your order {{order_number}} sold out',
		preheader: 'We’ve refunded you in full.',
		variables: {
			order_number: 'order number',
			amount: 'refunded amount',
			sold_out_items: 'the items that sold out',
			similar_url: 'one link to similar pieces',
		},
		body:
			h1('Sorry, it sold out') +
			p('Your payment for order <b>{{order_number}}</b> reached us after this piece sold out:') +
			items('sold_out_items') +
			panel(
				'We’ve refunded the full <b>{{amount}}</b> to the way you paid. Your bank may take a few working days to show it.',
			) +
			p(`Looking for something like it? ${A('{{similar_url}}', 'See similar pieces')}.`),
		sample: { ...ORDER, amount: '₹23,050', sold_out_items: [ITEMS[0]], similar_url: '#' },
	},
	{
		name: 'order_shipped',
		group: 'Orders',
		subject: 'Your Saha Textile order {{order_number}} has shipped',
		preheader: 'It’s on its way. Tracking details inside.',
		variables: {
			order_number: 'order number',
			courier_name: 'courier',
			tracking_number: 'tracking number',
			has_tracking_url: 'true when a tracking link was given',
			tracking_url: 'tracking link',
			order_url: 'link to the order page',
		},
		body:
			h1('Your order is on its way') +
			p('Order <b>{{order_number}}</b> has left our shop.') +
			panel(
				rows([
					['Courier', '{{courier_name}}'],
					['Tracking number', '<b>{{tracking_number}}</b>'],
				]),
			) +
			'{{#if has_tracking_url}}' +
			button('{{tracking_url}}', 'Track your parcel') +
			'{{else}}' +
			button('{{order_url}}', 'View your order') +
			'{{/if}}' +
			small('Tracking can take a day to show the first update.'),
		sample: {
			...ORDER,
			courier_name: 'DTDC',
			tracking_number: 'D47512398',
			has_tracking_url: true,
			tracking_url: '#',
		},
	},
	{
		name: 'order_delivered',
		group: 'Orders',
		subject: 'Your Saha Textile order {{order_number}} was delivered',
		preheader: 'We hope you love it.',
		variables: { order_number: 'order number', order_url: 'link to the order page' },
		body:
			h1('Delivered. We hope you love it!') +
			p('Order <b>{{order_number}}</b> has been delivered. Thank you for shopping with Saha Textile.') +
			p('If anything isn’t right, reply to this email and we’ll help.') +
			button('{{order_url}}', 'View your order'),
		sample: ORDER,
	},
	{
		name: 'order_cancelled',
		group: 'Orders',
		subject: 'Your Saha Textile order {{order_number}} was cancelled',
		preheader: 'Here’s what happens to your payment.',
		variables: {
			order_number: 'order number',
			has_refund: 'true when money goes back',
			refund_line: 'e.g. “₹23,050 goes back to the card or UPI you paid with.”',
			order_url: 'link to the order page',
		},
		body:
			h1('Your order was cancelled') +
			p('Order <b>{{order_number}}</b> has been cancelled.') +
			'{{#if has_refund}}' +
			panel('{{refund_line}} We’ll email you again when the refund is processed.') +
			'{{/if}}' +
			button('{{order_url}}', 'View your order'),
		sample: { ...ORDER, has_refund: true, refund_line: '₹23,050 goes back to the card or UPI you paid with.' },
	},
	{
		name: 'refund_processed',
		group: 'Orders',
		subject: 'Your refund for order {{order_number}} has been processed',
		preheader: 'Your bank may take a few working days to show it.',
		variables: { order_number: 'order number', amount: 'refunded amount', method_line: 'where it went' },
		body:
			h1('Your refund is on its way') +
			panel(
				rows([
					['Order', '{{order_number}}'],
					['Refund', '<b>{{amount}}</b>'],
					['Sent to', '{{method_line}}'],
				]),
			) +
			p('Your bank may take a few working days to show it.'),
		sample: { ...ORDER, amount: '₹23,050', method_line: 'the card you paid with' },
	},
	{
		name: 'tax_invoice',
		group: 'Orders',
		subject: 'Tax invoice for your Saha Textile order {{order_number}}',
		preheader: 'Your GST invoice is attached as a PDF.',
		variables: {
			order_number: 'order number',
			invoice_number: 'invoice number',
			invoice_date: 'date',
			order_url: 'link to the order page',
		},
		body:
			h1('Your tax invoice') +
			p(
				'Your order <b>{{order_number}}</b> has been dispatched. Its tax invoice is attached to this email as a PDF.',
			) +
			panel(
				rows([
					['Invoice number', '{{invoice_number}}'],
					['Invoice date', '{{invoice_date}}'],
				]),
			) +
			p(`You can also download it any time from ${A('{{order_url}}', 'your order page')}.`),
		sample: { ...ORDER, invoice_number: 'ST/26-27/000123', invoice_date: '20 Nov 2026' },
	},
	{
		name: 'payment_receipt',
		group: 'Orders',
		isNew: true,
		subject: 'Payment received: {{amount}}, thank you',
		preheader: 'Your payment receipt from Saha Textile.',
		variables: {
			name: 'name or business name',
			amount: 'formatted ₹ amount',
			method_line: 'e.g. “Bank transfer (NEFT) · UTR SBIN…”',
			received_on: 'date',
			for_line: 'the order(s) it pays',
			has_balance: 'true for business accounts',
			balance_line: 'e.g. “Balance on your account: ₹0”',
		},
		body:
			h1('Payment received, thank you') +
			p('Hello {{name}}, we’ve received your payment.') +
			panel(
				rows([
					['Amount', '<b>{{amount}}</b>'],
					['Paid by', '{{method_line}}'],
					['Received on', '{{received_on}}'],
					['For', '{{for_line}}'],
				]),
			) +
			'{{#if has_balance}}' +
			p('{{balance_line}}') +
			'{{/if}}' +
			small('Keep this email as your receipt.'),
		sample: {
			name: 'Bose Boutique',
			amount: '₹18,400',
			method_line: 'Bank transfer (NEFT) · UTR SBIN52026112000981',
			received_on: '20 Nov 2026',
			for_line: 'Order ST-48171-21094',
			has_balance: true,
			balance_line: 'Balance on your account: ₹0.',
		},
	},
	{
		name: 'product_question_answered',
		group: 'Shop',
		subject: 'Your question about a Saha Textile product was answered',
		preheader: 'See our answer on the product page.',
		variables: { product_name: 'product name', question: 'the question asked', product_url: 'link to the answer' },
		body:
			h1('We answered your question') +
			p('You asked about <b>{{product_name}}</b>:') +
			panel('“{{question}}”') +
			button('{{product_url}}', 'Read the answer'),
		sample: {
			product_name: 'Red Banarasi Katan Silk Saree',
			question: 'Does it come with a blouse piece?',
			product_url: '#',
		},
	},
	{
		name: 'back_in_stock',
		group: 'Shop',
		subject: '{{product_name}} is back in stock at Saha Textile',
		preheader: 'The piece you asked about is available again.',
		variables: { product_name: 'product name', image: 'product picture', product_url: 'link to the product' },
		body:
			h1('It’s back in stock') +
			`<img src="{{image}}" width="160" alt="" style="display:block;width:160px;height:auto;border-radius:6px;margin:4px 0 14px">` +
			p('<b>{{product_name}}</b>, which you asked us to tell you about, is available again.') +
			button('{{product_url}}', 'See it') +
			small('We only tell you once for each request.'),
		sample: { product_name: 'Red Banarasi Katan Silk Saree', image: IMG(1), product_url: '#' },
	},
	{
		name: 'shop_event_announcement',
		group: 'Marketing',
		kind: 'marketing',
		subject: '{{title}} at Saha Textile',
		preheader: '{{message}}',
		variables: {
			title: 'event title',
			message: 'one or two lines',
			when_line: 'e.g. “Until 30 Nov”',
			link: 'link to the sale or collection',
			unsubscribe_url: 'one-click unsubscribe link',
		},
		body: h1('{{title}}') + p('{{message}}') + panel('<b>{{when_line}}</b>') + button('{{link}}', 'Shop now'),
		sample: {
			title: 'Winter Wedding Sale',
			message: 'Lower prices on selected silk and Banarasi sarees.',
			when_line: '25–30 Nov 2026',
			link: '#',
			unsubscribe_url: '#',
		},
	},
	{
		name: 'newsletter_issue',
		group: 'Marketing',
		kind: 'marketing',
		subject: '{{subject}}',
		preheader: '{{preheader}}',
		variables: {
			subject: 'issue subject',
			preheader: 'one line shown in the inbox',
			content: 'the issue written in our admin (HTML; see the open question)',
			unsubscribe_url: 'one-click unsubscribe link',
		},
		body: '{{{content}}}',
		sample: {
			subject: 'New in: handloom tant for winter',
			preheader: 'Five new weaves from Shantipur.',
			content:
				h1('New in: handloom tant') +
				p('Five new weaves from Shantipur, in soft winter colours.') +
				button('#', 'See the collection'),
			unsubscribe_url: '#',
		},
	},
];

export const render = (t) =>
	layout({
		title: t.subject.replace(/\{\{[^}]+\}\}/g, '').trim(),
		preheader: t.preheader,
		body: t.body,
		kind: t.kind ?? 'transactional',
	});

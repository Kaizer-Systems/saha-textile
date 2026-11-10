/** The destinations of the product share menu (owner-approved share brief, sections H and I). */
export type ShareGroup = 'send' | 'post' | 'story';

/**
 * One place a product can go. A target with `href` opens that app's own share address; a
 * `picture` target hands our picture and caption to the phone's share sheet, where the shopper
 * picks the app entry the hint names.
 */
export interface ShareTarget {
	/** Also the `?ref=` tag on the shared link, so visits can be counted per destination. */
	id: string;
	group: ShareGroup;
	icon: string;
	/** App name as written, or a translation key starting with `share_`. */
	app: string;
	/** Translation key for the hover name and screen readers. */
	label: string;
	href?: string;
	/** Which picture the share sheet receives: the tall card for Status and Stories, the photo for posts. */
	picture?: 'tall' | 'photo';
	/** Opens the app's composer in a small window on a computer. */
	window?: boolean;
	/** Translation key of the hint shown once the caption is copied. */
	hint?: string;
}

export interface ShareSubject {
	name: string;
	/** The page address in the shopper's language, with the chosen colour when there is one. */
	url: string;
	/** The ready message (name, price, facts, invitation); the address is added per destination. */
	message: string;
	/** One line for X: name, price and hashtags. */
	short: string;
}

const enc = encodeURIComponent;

/** Adds the destination's tag to the address. */
export const tagged = (url: string, ref: string): string => `${url}${url.includes('?') ? '&' : '?'}ref=${ref}`;

/**
 * Phones that share pictures get the lean menu (owner choice): WhatsApp message and Facebook post
 * open their apps directly; Instagram post, WhatsApp Status and Instagram Story go through the
 * phone's share sheet with the right picture; every other app is reached through More. There is
 * no Facebook Story: from a website Facebook only makes a feed post.
 *
 * Computers have no app sheet, so they list every app's own share address.
 */
export function shareTargets(subject: ShareSubject, phone: boolean): ShareTarget[] {
	const link = (ref: string) => tagged(subject.url, ref);
	const whatsapp: ShareTarget = {
		id: 'wa',
		group: 'send',
		icon: 'ri-whatsapp-fill',
		app: 'WhatsApp',
		label: 'share_on_whatsapp',
		href: `https://wa.me/?text=${enc(`${subject.message}\n${link('wa')}`)}`,
	};
	const facebook: ShareTarget = {
		id: 'fb',
		group: 'post',
		icon: 'ri-facebook-fill',
		app: 'Facebook',
		label: 'share_on_facebook',
		href: `https://www.facebook.com/sharer/sharer.php?u=${enc(link('fb'))}`,
		window: true,
	};
	if (phone) {
		return [
			whatsapp,
			facebook,
			{
				id: 'ig-post',
				group: 'post',
				icon: 'ri-instagram-fill',
				app: 'Instagram',
				label: 'share_instagram_post',
				picture: 'photo',
				hint: 'share_hint_instagram_post',
			},
			{
				id: 'wa-status',
				group: 'story',
				icon: 'ri-whatsapp-fill',
				app: 'WhatsApp',
				label: 'share_whatsapp_status',
				picture: 'tall',
				hint: 'share_hint_whatsapp_status',
			},
			{
				id: 'ig-story',
				group: 'story',
				icon: 'ri-instagram-fill',
				app: 'Instagram',
				label: 'share_instagram_story',
				picture: 'tall',
				hint: 'share_hint_instagram_story',
			},
		];
	}
	return [
		whatsapp,
		{
			id: 'tg',
			group: 'send',
			icon: 'ri-telegram-fill',
			app: 'Telegram',
			label: 'share_on_telegram',
			href: `https://t.me/share/url?url=${enc(link('tg'))}&text=${enc(subject.message)}`,
		},
		{
			id: 'mail',
			group: 'send',
			icon: 'ri-mail-fill',
			app: 'share_app_email',
			label: 'share_by_email',
			href: `mailto:?subject=${enc(subject.name)}&body=${enc(`${subject.message}\n${link('mail')}`)}`,
		},
		facebook,
		{
			id: 'x',
			group: 'post',
			icon: 'ri-twitter-x-fill',
			app: 'X',
			label: 'share_on_x',
			href: `https://x.com/intent/tweet?text=${enc(subject.short)}&url=${enc(link('x'))}`,
			window: true,
		},
		{
			id: 'li',
			group: 'post',
			icon: 'ri-linkedin-fill',
			app: 'LinkedIn',
			label: 'share_on_linkedin',
			href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link('li'))}`,
			window: true,
		},
		{
			id: 'pin',
			group: 'post',
			icon: 'ri-pinterest-fill',
			app: 'Pinterest',
			label: 'share_on_pinterest',
			href: `https://www.pinterest.com/pin/create/button/?url=${enc(link('pin'))}&description=${enc(subject.name)}`,
			window: true,
		},
	];
}

/** `#BanarasiSaree`-style tags from the product's facts, at most three, for X only. */
export const hashtags = (facts: readonly string[]): string =>
	facts
		.map((fact) => fact.replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
		.filter(Boolean)
		.slice(0, 3)
		.map(
			(fact) =>
				`#${fact
					.split(' ')
					.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
					.join('')}`,
		)
		.join(' ');

// One shared layout for every Saha Textile email, written for MSG91 templates:
// - inline CSS on every element (MSG91: "If you are set on using CSS, your best bet is to use inline code");
//   the one <style> block only makes the 600 px column full-width on phones (clients that drop it still work);
// - tables for layout, no JavaScript, no forms, no background images, no web fonts;
// - images are absolute https PNG/JPG links (MSG91 accepts PNG, JPG, GIF up to 1 MB);
// - Handlebars only as MSG91 supports it: {{var}}, {{#if}}/{{else}}, {{#unless}}, {{#each}}, {{@root.x}};
//   anything conditional is a true/false flag sent by our server (no comparison helpers exist there);
// - [[token]] marks are filled by our build per environment before the template is registered
//   (shop origin, admin origin, the shop's registered name and address), so no hostname lives in the API.

export const C = {
	ink: '#1f2933',
	muted: '#5f6b76',
	line: '#e3e7eb',
	bg: '#f3f5f7',
	panel: '#f6f8fa',
	brand: '#417394', // the shop's top bar
	button: '#d22e2d', // the shop's Pay button
	warn: '#8a5300',
	warnBg: '#fff6e0',
};
export const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A bulletproof button (table cell with a background colour), readable when images are off. */
export const button = (href, label) =>
	`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px"><tr><td align="center" bgcolor="${C.button}" style="border-radius:6px;background:${C.button}"><a href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px">${label}</a></td></tr></table>`;

export const h1 = (t) =>
	`<h1 style="margin:0 0 12px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${C.ink}">${t}</h1>`;
export const p = (t, o = {}) =>
	`<p style="margin:0 0 ${o.mb ?? 14}px;font-family:${FONT};font-size:${o.size ?? 15}px;line-height:${o.lh ?? 24}px;color:${o.color ?? C.ink}">${t}</p>`;
export const small = (t) => p(t, { size: 13, lh: 20, color: C.muted });

/** A one-time code, large and easy to copy. */
export const code = (v) =>
	`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr><td style="background:${C.panel};border:1px solid ${C.line};border-radius:8px;padding:14px 22px;font-family:'SFMono-Regular', Menlo, Consolas, monospace;font-size:30px;line-height:36px;letter-spacing:8px;font-weight:700;color:${C.ink}">${v}</td></tr></table>`;

/** A soft panel for addresses, payment lines and notes. */
export const panel = (inner, tone = 'plain') =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr><td style="background:${tone === 'warn' ? C.warnBg : C.panel};border-radius:8px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:22px;color:${tone === 'warn' ? C.warn : C.ink}">${inner}</td></tr></table>`;

/** Label / value rows inside a panel. */
export const rows = (list) =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${list
		.map(
			([k, v]) =>
				`<tr><td valign="top" style="padding:3px 12px 3px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};white-space:nowrap">${k}</td><td valign="top" style="padding:3px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink}">${v}</td></tr>`,
		)
		.join('')}</table>`;

/** Ordered items, cart style (OD19). `{{#each items}}` with image, name, options, quantity, price, total. */
export const items = (list = 'items') =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;border-top:1px solid ${C.line}">{{#each ${list}}}<tr><td width="72" valign="top" style="padding:12px 12px 12px 0;border-bottom:1px solid ${C.line}"><img src="{{image}}" width="64" height="80" alt="" style="display:block;width:64px;height:80px;border-radius:4px;object-fit:cover;background:${C.panel}"></td><td valign="top" style="padding:12px 0;border-bottom:1px solid ${C.line};font-family:${FONT}"><div style="font-size:15px;line-height:21px;font-weight:600;color:${C.ink}">{{name}}</div>{{#if options}}<div style="font-size:13px;line-height:19px;color:${C.muted}">{{options}}</div>{{/if}}<div style="font-size:13px;line-height:19px;color:${C.muted}">{{quantity}} × {{price}}</div>{{#if note}}<div style="font-size:13px;line-height:19px;color:${C.warn}">{{note}}</div>{{/if}}</td><td valign="top" align="right" style="padding:12px 0 12px 12px;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:21px;font-weight:600;color:${C.ink};white-space:nowrap">{{total}}</td></tr>{{/each}}</table>`;

/** Order totals. Every figure arrives formatted by our server, in the order's currency. */
export const totals = (list) =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">${list
		.map(
			([k, v, strong, note]) =>
				`${note ? `{{#if ${note}}}` : ''}<tr><td style="padding:4px 0;font-family:${FONT};font-size:${strong ? 16 : 14}px;line-height:22px;color:${strong ? C.ink : C.muted};font-weight:${strong ? 700 : 400}">${k}</td><td align="right" style="padding:4px 0;font-family:${FONT};font-size:${strong ? 16 : 14}px;line-height:22px;color:${C.ink};font-weight:${strong ? 700 : 400};white-space:nowrap">${v}</td></tr>${note ? '{{/if}}' : ''}`,
		)
		.join('')}</table>`;

/**
 * The page around a body. `kind` decides the footer: transactional mail says why it was sent and never
 * carries an unsubscribe link; marketing mail (newsletter, sale and launch news) carries one.
 */
export function layout({ title, preheader, body, kind = 'transactional', why }) {
	const footerWhy =
		kind === 'marketing'
			? `You’re getting this because you agreed to hear about new arrivals and offers from Saha Textile. <a href="{{unsubscribe_url}}" style="color:${C.muted};text-decoration:underline">Unsubscribe</a>.`
			: (why ?? 'You’re getting this email about your Saha Textile account or order.');
	return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<style>@media only screen and (max-width:620px){.st-col{width:100%!important}.st-pad{padding-left:18px!important;padding-right:18px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};font-size:1px;line-height:1px">${preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="st-col" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:10px;border-top:4px solid ${C.brand}">
<tr><td class="st-pad" style="padding:22px 32px 6px"><a href="[[shop_origin]]" target="_blank"><img src="[[shop_origin]]/email/saha-textile-logo-480.png" width="190" alt="Saha Textile" style="display:block;width:190px;height:auto;border:0"></a></td></tr>
<tr><td class="st-pad" style="padding:18px 32px 8px">${body}</td></tr>
<tr><td class="st-pad" style="padding:8px 32px 26px">${p(`Questions? Reply to this email or write to <a href="mailto:wecare@sahatextile.com" style="color:${C.brand}">wecare@sahatextile.com</a>.`, { size: 13, lh: 20, color: C.muted, mb: 0 })}</td></tr>
</table>
<table role="presentation" class="st-col" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px"><tr><td class="st-pad" style="padding:16px 32px 4px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}" align="center">${footerWhy}<br>[[legal_name]] · [[shop_address]]</td></tr></table>
</td></tr></table>
</body>
</html>
`;
}

/**
 * Masks personal data and secrets in a log message before it is written, so a careless log
 * call cannot leak a shopper's email or phone, or a live token, into 30 days of history.
 *
 * - emails keep their first letter and domain: `r***@gmail.com`;
 * - Indian mobile numbers and `+`-prefixed international numbers keep their last 2 digits;
 * - bearer tokens, JWTs and secret-looking query or JSON values become `[masked]`;
 * - an address (`maskAddress`) keeps its shape instead: secret values become `{{name}}` placeholders.
 *
 * Product ids, SKUs, prices, order numbers and ISO dates are left alone.
 */
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const INDIAN_MOBILE = /(?<![\w+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{3}(\d{2})(?![\w])/g;
const INTERNATIONAL = /(?<![\w])\+\d{1,3}[\s-]?(?:\d[\s-]?){5,11}(\d{2})(?![\w])/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
// A value that is already a placeholder (`{{token}}`, from maskAddress) is not a secret.
const SECRET_PAIR =
	/\b(password|passwd|pin|otp|code|token|access_token|refresh_token|secret|api[_-]?key|authorization|signature|sig|csrf[_-]?token)(["']?\s*[:=]\s*["']?)(?!Bearer\b)(?!\{\{)([^\s"'&,;}]+)/gi;

/**
 * Query parameters whose value is a secret in an address. Must equal the list in the edge's log
 * masking (docker/stack/nginx/edge.conf and docker/production/nginx/edge.conf.template); a test
 * keeps the three in step.
 */
export const ADDRESS_SECRET_NAMES = [
	'token',
	'code',
	'state',
	'key',
	'secret',
	'signature',
	'sig',
	'password',
	'passwd',
	'pin',
	'otp',
	'access_token',
	'refresh_token',
	'id_token',
	'client_secret',
	'csrf_token',
	'api_key',
	'apikey',
	'auth',
	'authkey',
	'session',
	'payerid',
] as const;

const ADDRESS_SECRET_PARAM = new RegExp(`([?&])(${ADDRESS_SECRET_NAMES.join('|')})=[^&#]*`, 'gi');
/** The payment link carries its token as a path segment: /<locale>/pay/<token>, /storefront/pay/<token>. */
const PAY_LINK_TOKEN = /^([^?]*?\/pay\/)[^/?]+/;

/**
 * An address as a log line may show it (owner, 2026-11-21): a one-time token, code or key keeps its
 * place, but its value becomes a placeholder named after it (`/en/pay/{{token}}`,
 * `?token={{token}}&lang=en`), so the address keeps its shape and nothing logged can be replayed.
 * Emails and phone numbers are masked as in any message. The edge masks its request log the same way.
 */
export function maskAddress(url: string): string {
	return maskPersonalData(url)
		.replace(PAY_LINK_TOKEN, '$1{{token}}')
		.replace(ADDRESS_SECRET_PARAM, (_match, separator: string, name: string) => `${separator}${name}={{${name}}}`);
}

export function maskPersonalData(text: string): string {
	return text
		.replace(JWT, '[masked-jwt]')
		.replace(BEARER, '$1 [masked]')
		.replace(SECRET_PAIR, '$1$2[masked]')
		.replace(EMAIL, '$1***@$2')
		.replace(INDIAN_MOBILE, '********$1')
		.replace(INTERNATIONAL, '+********$1');
}

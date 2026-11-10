/**
 * Masks personal data and secrets in a log message before it is written, so a careless log
 * call cannot leak a shopper's email or phone, or a live token, into 30 days of history.
 *
 * - emails keep their first letter and domain: `r***@gmail.com`;
 * - Indian mobile numbers and `+`-prefixed international numbers keep their last 2 digits;
 * - bearer tokens, JWTs and secret-looking query or JSON values become `[masked]`.
 *
 * Product ids, SKUs, prices, order numbers and ISO dates are left alone.
 */
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const INDIAN_MOBILE = /(?<![\w+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{3}(\d{2})(?![\w])/g;
const INTERNATIONAL = /(?<![\w])\+\d{1,3}[\s-]?(?:\d[\s-]?){5,11}(\d{2})(?![\w])/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const SECRET_PAIR =
	/\b(password|passwd|pin|otp|code|token|access_token|refresh_token|secret|api[_-]?key|authorization|signature|sig|csrf[_-]?token)(["']?\s*[:=]\s*["']?)(?!Bearer\b)([^\s"'&,;}]+)/gi;

export function maskPersonalData(text: string): string {
	return text
		.replace(JWT, '[masked-jwt]')
		.replace(BEARER, '$1 [masked]')
		.replace(SECRET_PAIR, '$1$2[masked]')
		.replace(EMAIL, '$1***@$2')
		.replace(INDIAN_MOBILE, '********$1')
		.replace(INTERNATIONAL, '+********$1');
}

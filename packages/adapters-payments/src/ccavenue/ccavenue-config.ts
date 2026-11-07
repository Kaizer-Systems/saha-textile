import { z } from 'zod';

/**
 * CCAvenue allows 100 characters for a return URL and prints letters, digits, `/` and `_` as
 * its path characters. The value travels unescaped inside a `name=value&` string, so `&`, `=`,
 * a query and a fragment are all refused.
 */
const MAX_RETURN_URL_LENGTH = 100;

const withoutTrailingSlash = (value: string): string => value.replace(/\/$/, '');

/** A bare host only. The kits' raw IP and `.ae` addresses are refused. */
const CcavenueHost = z
	.string()
	.refine(
		(value) => {
			if (!URL.canParse(value)) return false;
			const url = new URL(value);
			const isHttpsOrigin = url.protocol === 'https:' && url.origin === withoutTrailingSlash(value);
			return isHttpsOrigin && url.hostname.endsWith('.ccavenue.com');
		},
		{ message: 'must be an https host on ccavenue.com' },
	)
	.transform(withoutTrailingSlash);

const ReturnUrl = z
	.string()
	.max(MAX_RETURN_URL_LENGTH)
	.refine(
		(value) => {
			if (!URL.canParse(value) || /[&=?#\s]/.test(value)) return false;
			const url = new URL(value);
			return url.protocol === 'https:' && /^[A-Za-z0-9/_]+$/.test(url.pathname);
		},
		{ message: 'must be an https URL with no query or fragment, and a path of letters, digits, / and _' },
	);

const CcavenueGatewayConfig = z.object({
	merchantId: z.string().regex(/^\d+$/, 'must be numeric'),
	accessCode: z.string().regex(/^\S+$/, 'must not contain spaces'),
	workingKey: z.string().regex(/^\S{32}$/, 'must be the 32-character key from M.A.R.S'),
	/** The payment page host, for example `https://test.ccavenue.com`. */
	baseUrl: CcavenueHost,
	/** The merchant API host, for example `https://apitest.ccavenue.com`. */
	apiUrl: CcavenueHost,
	/** The one return address registered with the bank. */
	returnUrl: ReturnUrl,
	timeoutMs: z.number().int().positive().default(15_000),
});

export type CcavenueConfig = z.infer<typeof CcavenueGatewayConfig>;

export type CcavenueGatewayOptions = z.input<typeof CcavenueGatewayConfig> & { fetch?: typeof fetch };

/** Names the bad settings and never repeats a value, because boot errors reach container logs. */
export function parseCcavenueConfig(options: CcavenueGatewayOptions): CcavenueConfig {
	const parsed = CcavenueGatewayConfig.safeParse(options);
	if (parsed.success) return parsed.data;
	const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
	throw new Error(`CCAvenue configuration is invalid: ${names}`);
}

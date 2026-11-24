import { createHash, createHmac } from 'node:crypto';

const sha256 = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

export interface SignInput {
	method: string;
	url: URL;
	region: string;
	service: string;
	accessKey: string;
	secret: string;
	/** `20150830T123600Z`; defaults to now. */
	amzDate?: string;
	headers?: Record<string, string>;
	payload?: string;
}

/**
 * AWS Signature Version 4, which DigitalOcean Spaces accepts. Returns the headers to send:
 * `authorization`, `x-amz-date`, `x-amz-content-sha256` and any extra headers given.
 */
export function signV4(input: SignInput): Record<string, string> {
	const amzDate =
		input.amzDate ??
		new Date()
			.toISOString()
			.replace(/[-:]/g, '')
			.replace(/\.\d{3}/, '');
	const day = amzDate.slice(0, 8);
	const payloadHash = sha256(input.payload ?? '');
	const headers: Record<string, string> = { ...input.headers, host: input.url.host, 'x-amz-date': amzDate };
	const names = Object.keys(headers)
		.map((h) => h.toLowerCase())
		.sort();
	const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
	const query = [...input.url.searchParams.entries()]
		.map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
		.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a < b ? -1 : 1))
		.map(([k, v]) => `${k}=${v}`)
		.join('&');
	const canonical = [
		input.method,
		// An https address always has a path, at least '/'.
		input.url.pathname,
		query,
		// `lower` holds every header named in `names`.
		names.map((n) => `${n}:${lower[n] as string}\n`).join(''),
		names.join(';'),
		payloadHash,
	].join('\n');
	const scope = `${day}/${input.region}/${input.service}/aws4_request`;
	const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
	const key = hmac(hmac(hmac(hmac(`AWS4${input.secret}`, day), input.region), input.service), 'aws4_request');
	const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
	return {
		...headers,
		'x-amz-content-sha256': payloadHash,
		authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
	};
}

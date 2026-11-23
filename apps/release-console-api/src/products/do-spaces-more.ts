/**
 * Spaces: CORS and files (owner, 23 Nov: "spaces, CORS and file browsing … make them as well"). These go
 * through the S3 API with the console's Spaces key, signed like the bucket reads. Uploading photos stays
 * the admin's media pipeline, which sizes and converts them; here a file can be found and deleted.
 */
import { createHash } from 'node:crypto';

import type { ProductWrite } from '@saha-textile/release-console-contracts';

import type { ProductCtx, ProductFormSpec } from './kit.js';
import { action, col, confirmed, field, form, formTab, note, option, pick, row, table, text, view } from './kit.js';
import { type ScreenExtra } from './cf-zone-more.js';
import { buckets, s3, tags } from './do-services.js';
import { signV4 } from '../vendors/sigv4.js';
import { VendorError } from '../vendors/http.js';

const opt = (w: ProductWrite, key: string) => {
	const v = w.values[key];
	return typeof v === 'string' ? v.trim() : '';
};

/** A signed S3 write with a body (CORS needs one, with its MD5). */
async function s3Put(ctx: ProductCtx, bucket: string, region: string, path: string, body: string): Promise<void> {
	const accessKey = ctx.consoleKey('CONSOLE_SPACES_ACCESS_KEY');
	const secret = ctx.consoleKey('CONSOLE_SPACES_SECRET_KEY');
	if (!accessKey || !secret) throw new VendorError('Spaces needs the console’s Spaces key (pnpm console:env).', 400);
	const url = new URL(`https://${bucket}.${region}.digitaloceanspaces.com${path}`);
	const md5 = createHash('md5').update(body).digest('base64');
	const headers = signV4({
		method: 'PUT',
		url,
		region: 'us-east-1',
		service: 's3',
		accessKey,
		secret,
		payload: body,
		headers: { 'content-md5': md5, 'content-type': 'application/xml' },
	});
	const res = await fetch(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(15_000) });
	if (!res.ok) {
		const t = await res.text();
		throw new VendorError(
			`Spaces answered ${res.status}${/<Code>([^<]+)/.exec(t)?.[1] ? `: ${/<Code>([^<]+)/.exec(t)?.[1]}` : ''}.`,
			res.status,
		);
	}
}

const bucketChoices = async (ctx: ProductCtx) =>
	(await buckets(ctx)).map((b) => ({ value: `${b.name}|${b.region || 'sgp1'}`, label: b.name }));

const corsForm: ProductFormSpec = {
	async read(ctx) {
		const all = await bucketChoices(ctx);
		const p = pick('Bucket', all, ctx.id);
		const [name, region] = (p.value ?? '').split('|');
		const xml = name ? await s3(ctx, '/?cors', region, name).catch(() => '') : '';
		const origins = tags(xml, 'AllowedOrigin');
		return formTab(
			form({
				key: 'cors',
				title: name ? `CORS for ${name}` : 'CORS',
				submit: 'Save CORS',
				blocked: name ? null : 'No buckets the Spaces key can reach.',
				fields: [
					field('origins', 'Sites that may read it from a browser', 'textarea', {
						value: origins.join('\n'),
						help: 'One per line, like https://sahatextile.com; empty removes CORS',
					}),
					field('methods', 'Methods', 'select', {
						value: tags(xml, 'AllowedMethod').includes('PUT') ? 'GET,HEAD,PUT' : 'GET,HEAD',
						options: [
							option('GET,HEAD', 'Read only (GET, HEAD)'),
							option('GET,HEAD,PUT', 'Read and upload (GET, HEAD, PUT)'),
						],
					}),
				],
				notes: [
					note(
						'Photos load from the CDN address; CORS matters for pages that fetch files with JavaScript.',
						'muted',
					),
				],
			}),
			p,
		);
	},
	async send(ctx, w) {
		const [name = '', region = 'sgp1'] = (w.id ?? ctx.id ?? '').split('|');
		if (!name) throw new VendorError('Choose a bucket.', 400);
		const origins = opt(w, 'origins')
			.split('\n')
			.map((o) => o.trim())
			.filter(Boolean);
		if (!origins.every((o) => /^https?:\/\/[^\s/]+$/.test(o) || o === '*'))
			throw new VendorError('Sites like https://sahatextile.com, one per line.', 400);
		if (!origins.length) {
			await s3(ctx, '/?cors', region, name, 'DELETE');
			return { message: `CORS removed from ${name}`, productId: null, follow: [] };
		}
		const methods = (opt(w, 'methods') || 'GET,HEAD').split(',');
		const body = `<CORSConfiguration><CORSRule>${origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join('')}${methods.map((m) => `<AllowedMethod>${m}</AllowedMethod>`).join('')}<AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
		await s3Put(ctx, name, region, '/?cors', body);
		return { message: `CORS on ${name}: ${origins.join(', ')}`, productId: null, follow: [] };
	},
};

const filesTab = async (ctx: ProductCtx) => {
	const all = await bucketChoices(ctx);
	const p = pick('Bucket', all, ctx.id);
	const [name, region] = (p.value ?? '').split('|');
	const xml = name ? await s3(ctx, '/?list-type=2&max-keys=200', region, name) : '';
	const keys = tags(xml, 'Key');
	const sizes = tags(xml, 'Size').map(Number);
	const dates = tags(xml, 'LastModified');
	return view(
		{
			tables: [
				table(
					`Files in ${name ?? ''} (first 200)`,
					[col('key', 'File', true), col('size', 'Size', true), col('at', 'Changed', true)],
					keys.map((k, n) =>
						row(k, k, {
							key: k,
							size: `${Math.round((sizes[n] ?? 0) / 1024)} KB`,
							at: (dates[n] ?? '').slice(0, 16).replace('T', ' '),
						}),
					),
					'No files.',
				),
			],
			notes: [
				note(
					'Photos are uploaded through the admin, which makes every size and format; this list finds and deletes files.',
					'muted',
				),
			],
			actions: [action('Delete a file', 'filedelete'), action('CORS', 'cors')],
		},
		p,
	);
};

const fileDelete: ProductFormSpec = {
	read: async (ctx) =>
		formTab(
			form({
				key: 'filedelete',
				title: 'Delete a file from Spaces',
				submit: 'Delete file',
				danger: true,
				fields: [
					field('bucket', 'Bucket', 'select', {
						options: (await bucketChoices(ctx)).map((b) => option(b.value, b.label)),
					}),
					field('key', 'File (its full path)', 'text', {
						required: true,
						help: 'Copy it from the Files list',
					}),
				],
				notes: [
					note(
						'A photo the shop still links to then shows as missing; the media pipeline’s own delete keeps them in step.',
						'amber',
					),
				],
			}),
		),
	async send(ctx, w) {
		const [name = '', region = 'sgp1'] = opt(w, 'bucket').split('|');
		const key = text(w, 'key').replace(/^\/+/, '');
		if (!name || !key || key.includes('..')) throw new VendorError('Choose a bucket and a file path.', 400);
		confirmed(w, key.split('/').pop() ?? key);
		await s3(ctx, `/${key.split('/').map(encodeURIComponent).join('/')}`, region, name, 'DELETE');
		return { message: `${key} deleted from ${name}`, productId: null, follow: [] };
	},
};

export const SPACES_MORE_EXTRA: ScreenExtra = {
	tabs: { files: filesTab },
	forms: { cors: corsForm, filedelete: fileDelete },
	buttons: { buckets: [action('CORS', 'cors')] },
};

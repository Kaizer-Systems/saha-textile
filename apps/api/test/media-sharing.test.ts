import { createHash } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { type AuditLog, MediaAsset, type ShareLink } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MediaSharingService, newShareCode, shareCodeHash } from '../src/media/media-sharing.service';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** In-memory links, files, signer, passwords and limits for the sharing rules. */
function harness() {
	const links = new Map<string, ShareLink>();
	const files = new Map<string, MediaAsset>();
	const audit: AuditLog[] = [];
	const signed: { key: string; expiresInSeconds: number; fileName?: string }[] = [];
	const failures = new Map<string, number>();
	let openBlocked = false;

	const linkRepo = {
		create: async (link: ShareLink) => (links.set(link.id, link), link),
		findById: async (id: string) => links.get(id) ?? null,
		findByCodeHash: async (hash: string) => [...links.values()].find((row) => row.codeHash === hash) ?? null,
		listForAsset: async (assetId: string) => [...links.values()].filter((row) => row.assetId === assetId),
		save: async (link: ShareLink) => (links.set(link.id, link), link),
		countOpen: async (id: string, at: string) => {
			const link = links.get(id) as ShareLink;
			links.set(id, { ...link, opens: link.opens + 1, lastOpenedAt: at });
		},
	};
	const assets = { findById: async (id: string) => files.get(id) ?? null };
	const storage = {
		getUrl: (key: string) => `https://cdn.test/${key}`,
		createSignedDownloadUrl: async (input: { key: string; expiresInSeconds: number; fileName?: string }) => {
			signed.push(input);
			return `https://spaces.test/${input.key}?signed`;
		},
	};
	const passwords = {
		hashPassword: async (plain: string) => `argon:${plain}`,
		verifyPassword: async (plain: string, hash: string) => hash === `argon:${plain}`,
	};
	const limits = {
		consumeRateLimit: vi.fn(async () => (openBlocked ? { allowed: false } : { allowed: true })),
		checkRateLimit: async (_action: string, scopes: { identifier?: string }) => ({
			allowed: (failures.get(scopes.identifier ?? '') ?? 0) < 10,
		}),
		recordRateLimitFailure: async (_action: string, scopes: { identifier?: string }) =>
			void failures.set(scopes.identifier ?? '', (failures.get(scopes.identifier ?? '') ?? 0) + 1),
	};
	const auditRepo = { append: async (entry: AuditLog) => (audit.unshift(entry), entry) };
	const service = new MediaSharingService(
		linkRepo as never,
		assets as never,
		storage as never,
		passwords as never,
		auditRepo as never,
		limits as never,
		{
			findById: async (id: string) =>
				id === 'adm_1' ? { id, displayName: 'Moulik', username: null, email: null } : null,
		} as never,
	);
	const file = (id: string, overrides: Record<string, unknown> = {}) =>
		files.set(
			id,
			MediaAsset.parse({
				id,
				kind: 'file',
				originalFormat: 'application/pdf',
				originalByteSize: 5000,
				slug: id.replace(/_/g, '-'),
				originalStorageKey: `media/${id}/original.pdf`,
				displayName: 'Bridal catalogue 2027.pdf',
				visibility: 'private',
				processing: { state: 'ready', attempts: 0, error: null, processedAt: NOW.toISOString() },
				...overrides,
			}),
		);
	return {
		service,
		links,
		files,
		audit,
		signed,
		file,
		limits,
		blockOpens: () => (openBlocked = true),
	};
}

const refusal = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		return ((error as HttpException).getResponse() as { issues?: { code: string }[] }).issues?.[0]?.code;
	}
	throw new Error('expected a refusal');
};
const ip = '203.0.113.9';

describe('share codes', () => {
	it('are 22 random letters and digits, different every time', () => {
		const codes = new Set(Array.from({ length: 500 }, newShareCode));
		expect(codes.size).toBe(500);
		for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{22}$/);
	});
});

describe('making links', () => {
	it('shows the code once, keeps only its hash and last four, and hashes the password', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create(
			'adm_1',
			'med_pdf',
			{ expiry: '7d', who: 'anyone', password: 'saree-2027' },
			NOW,
		);
		expect(made.code).toMatch(/^[A-Za-z0-9]{22}$/);
		const stored = h.links.get(made.id) as ShareLink;
		expect(stored.codeHash).toBe(
			createHash('sha256')
				.update(made.code as string)
				.digest('hex'),
		);
		expect(stored.codeEnd).toBe(made.code?.slice(-4));
		expect(stored.passwordHash).toBe('argon:saree-2027');
		expect(stored.expiresAt).toBe(later(7 * 86_400_000).toISOString());
		const listed = await h.service.list('med_pdf', NOW);
		expect(listed.links[0]).toMatchObject({
			id: made.id,
			hasPassword: true,
			state: 'active',
			createdByName: 'Moulik',
		});
		expect(listed.links[0]).not.toHaveProperty('code');
		expect(listed.links[0]).not.toHaveProperty('codeHash');
		expect(listed.links[0]).not.toHaveProperty('passwordHash');
		expect(h.audit[0]).toMatchObject({ action: 'media.share.create', entityId: 'med_pdf' });
		expect(JSON.stringify(h.audit)).not.toContain('saree-2027');
	});

	it('refuses public files, files in Trash and dates in the past', async () => {
		const h = harness();
		h.file('med_public', { visibility: 'public' });
		h.file('med_trash', { trashedAt: NOW.toISOString() });
		h.file('med_pdf');
		const anyone = { expiry: '1d' as const, who: 'anyone' as const };
		expect(await refusal(h.service.create('adm_1', 'med_public', anyone, NOW))).toBe('public_file');
		expect(await refusal(h.service.create('adm_1', 'med_trash', anyone, NOW))).toBe('file_in_trash');
		expect(
			await refusal(
				h.service.create(
					'adm_1',
					'med_pdf',
					{ ...anyone, expiry: 'date', expiresAt: '2026-01-01T00:00:00.000Z' },
					NOW,
				),
			),
		).toBe('date_in_past');
		const listed = await h.service.list('med_public', NOW);
		expect(listed.publicUrl).toBe('https://cdn.test/media/med_public/original.pdf');
	});

	it('shares a photo’s private original', async () => {
		const h = harness();
		h.file('med_photo', {
			kind: 'image',
			originalFormat: 'image/jpeg',
			originalStorageKey: 'media/med_photo/original.jpg',
			displayName: 'Red Banarasi front.jpg',
			visibility: 'public',
		});
		h.files.set('med_photo', {
			...(h.files.get('med_photo') as MediaAsset),
			derivatives: [
				{
					role: 'gallery',
					roleVersion: 1,
					width: 1600,
					height: 2133,
					format: 'image/webp',
					storageKey: 'media/med_photo/gallery-1600.webp',
					byteSize: 300,
				},
			],
		});
		expect(await h.service.list('med_photo', NOW)).toMatchObject({
			publicUrl: 'https://cdn.test/media/med_photo/gallery-1600.webp',
			publicPicture: { role: 'gallery', width: 1600 },
		});
		const made = await h.service.create('adm_1', 'med_photo', { expiry: '30d', who: 'anyone' }, NOW);
		expect(await h.service.open(made.code as string, { signedInAdmin: false, ip }, NOW)).toMatchObject({
			state: 'open',
			fileName: 'Red Banarasi front.jpg',
		});
		expect(h.signed[0]).toEqual({
			key: 'media/med_photo/original.jpg',
			expiresInSeconds: 300,
			fileName: 'Red Banarasi front.jpg',
		});
	});
});

describe('opening links', () => {
	it('hands the file over for five minutes and counts the open', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create('adm_1', 'med_pdf', { expiry: 'never', who: 'anyone' }, NOW);
		const answer = await h.service.open(made.code as string, { signedInAdmin: false, ip }, NOW);
		expect(answer).toEqual({
			state: 'open',
			url: 'https://spaces.test/media/med_pdf/original.pdf?signed',
			fileName: 'Bridal catalogue 2027.pdf',
			contentType: 'application/pdf',
			bytes: 5000,
		});
		expect(h.links.get(made.id)).toMatchObject({ opens: 1, lastOpenedAt: NOW.toISOString() });
	});

	it('answers expired for unknown, malformed, stopped and out-of-date links alike', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create('adm_1', 'med_pdf', { expiry: '1h', who: 'anyone' }, NOW);
		const code = made.code as string;
		expect(await h.service.open('x'.repeat(22), { signedInAdmin: false, ip }, NOW)).toEqual({ state: 'expired' });
		expect(await h.service.open('../../etc', { signedInAdmin: false, ip }, NOW)).toEqual({ state: 'expired' });
		expect(await h.service.open(code, { signedInAdmin: false, ip }, later(3_600_001))).toEqual({
			state: 'expired',
		});
		await h.service.update('adm_1', made.id, { stop: true }, NOW);
		expect(await h.service.open(code, { signedInAdmin: false, ip }, NOW)).toEqual({ state: 'expired' });
		expect(h.signed).toEqual([]);
	});

	it('opens admins-only links only for a signed-in admin', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create('adm_1', 'med_pdf', { expiry: '1d', who: 'admins' }, NOW);
		const code = made.code as string;
		expect(await h.service.open(code, { signedInAdmin: false, ip }, NOW)).toEqual({ state: 'admins_only' });
		expect(await h.service.open(code, { signedInAdmin: true, ip }, NOW)).toMatchObject({ state: 'open' });
	});

	it('asks for the password, says when it was wrong, and stops guessing after ten tries', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create(
			'adm_1',
			'med_pdf',
			{ expiry: '1d', who: 'anyone', password: 'tant-2027' },
			NOW,
		);
		const code = made.code as string;
		expect(await h.service.open(code, { signedInAdmin: false, ip }, NOW)).toEqual({
			state: 'password',
			wrong: false,
		});
		expect(await h.service.open(code, { password: 'nope', signedInAdmin: false, ip }, NOW)).toEqual({
			state: 'password',
			wrong: true,
		});
		expect(await h.service.open(code, { password: 'tant-2027', signedInAdmin: false, ip }, NOW)).toMatchObject({
			state: 'open',
		});
		// Break-it: a password tried 20 times. The 11th try is refused before it is even checked.
		const tries: string[] = [];
		for (let i = 0; i < 20; i += 1) {
			try {
				const answer = await h.service.open(code, { password: `guess-${i}`, signedInAdmin: false, ip }, NOW);
				tries.push(answer.state);
			} catch (error) {
				tries.push(String((error as HttpException).getStatus()));
			}
		}
		expect(tries.filter((state) => state === 'password')).toHaveLength(9);
		expect(tries.filter((state) => state === '429')).toHaveLength(11);
		await expect(
			h.service.open(code, { password: 'tant-2027', signedInAdmin: false, ip }, NOW),
		).rejects.toMatchObject({ status: 429 });
	});

	it('refuses an address that tries too many links', async () => {
		const h = harness();
		h.blockOpens();
		await expect(h.service.open('a'.repeat(22), { signedInAdmin: false, ip }, NOW)).rejects.toMatchObject({
			status: 429,
		});
	});
});

describe('changing links', () => {
	it('gives a live link a new end, and keeps a stopped link stopped, also after its file comes back', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create('adm_1', 'med_pdf', { expiry: '1h', who: 'anyone' }, NOW);
		const redated = await h.service.update('adm_1', made.id, { expiry: '30d' }, NOW);
		expect(redated.expiresAt).toBe(later(30 * 86_400_000).toISOString());
		expect(await h.service.open(made.code as string, { signedInAdmin: false, ip }, later(7_200_000))).toMatchObject(
			{
				state: 'open',
			},
		);
		await h.service.update('adm_1', made.id, { stop: true }, NOW);
		expect(await refusal(h.service.update('adm_1', made.id, { expiry: 'never' }, NOW))).toBe('link_stopped');
		expect(h.audit.map((entry) => entry.action)).toEqual([
			'media.share.stop',
			'media.share.expiry',
			'media.share.create',
		]);
	});

	it('follows the file when it moves or is renamed, and stops when it goes to Trash', async () => {
		const h = harness();
		h.file('med_pdf');
		const made = await h.service.create('adm_1', 'med_pdf', { expiry: 'never', who: 'anyone' }, NOW);
		const code = made.code as string;
		h.file('med_pdf', { folderId: 'fld_new', displayName: 'Bridal catalogue final.pdf' });
		expect(await h.service.open(code, { signedInAdmin: false, ip }, NOW)).toMatchObject({
			fileName: 'Bridal catalogue final.pdf',
		});
		h.file('med_pdf', { trashedAt: NOW.toISOString() });
		expect(await h.service.open(code, { signedInAdmin: false, ip }, NOW)).toEqual({ state: 'expired' });
	});

	it('hashes codes the same way it looks them up', () => {
		expect(shareCodeHash('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
	});
});

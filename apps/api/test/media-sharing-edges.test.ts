import { NotFoundException } from '@nestjs/common';
import { type AuditLog, MediaAsset, type ShareLink } from '@saha-textile/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MediaSharingService } from '../src/media/media-sharing.service';

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

type Harness = ReturnType<typeof harness>;

const link = (h: Harness, id: string, over: Partial<ShareLink> = {}) =>
	h.links.set(id, {
		id,
		assetId: 'med_pdf',
		codeHash: 'hash',
		codeEnd: 'abcd',
		who: 'anyone',
		expiresAt: null,
		passwordHash: null,
		stoppedAt: null,
		stoppedBecause: null,
		opens: 0,
		lastOpenedAt: null,
		createdBy: 'adm_1',
		createdAt: NOW.toISOString(),
		...over,
	});

describe('share links: the remaining cases', () => {
	it('names each link’s maker by any name they have, or nobody', async () => {
		const h = harness();
		h.file('med_pdf');
		link(h, 'shl_1', { createdBy: 'adm_1' });
		link(h, 'shl_2', { createdBy: 'adm_gone' });
		const listed = await h.service.list('med_pdf', NOW);
		expect(listed.links.map((row) => row.createdByName)).toEqual(['Moulik', null]);
	});

	it('refuses a file that is deleted, and a link that does not exist', async () => {
		const h = harness();
		h.file('med_gone', { deletedAt: NOW.toISOString() });
		await expect(h.service.list('med_gone', NOW)).rejects.toBeInstanceOf(NotFoundException);
		await expect(h.service.update('adm_1', 'shl_none', { stop: true } as never, NOW)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('stops a stopped link without saving it again, refuses a new end in the past, and saves nothing for an empty change', async () => {
		const h = harness();
		h.file('med_pdf');
		const stoppedAt = later(-1000).toISOString();
		link(h, 'shl_stopped', { stoppedAt, stoppedBecause: 'stopped' });
		await h.service.update('adm_1', 'shl_stopped', { stop: true } as never, NOW);
		expect(h.links.get('shl_stopped')?.stoppedAt).toBe(stoppedAt);
		link(h, 'shl_live');
		await expect(
			h.service.update(
				'adm_1',
				'shl_live',
				{ expiry: 'date', expiresAt: later(-60_000).toISOString() } as never,
				NOW,
			),
		).rejects.toMatchObject({ response: { issues: [{ code: 'date_in_past' }] } });
		const before = h.links.get('shl_live');
		await h.service.update('adm_1', 'shl_live', {} as never, NOW);
		expect(h.links.get('shl_live')).toBe(before);
	});
});

describe('share links: makers known only by a user name or an email', () => {
	it('names each maker by the first name they have', async () => {
		const h = harness();
		Object.defineProperty(h.service, 'admins', {
			value: {
				findById: async (id: string) =>
					({
						adm_user: { id, displayName: null, username: 'ravi', email: 'ravi@example.test' },
						adm_mail: { id, displayName: null, username: null, email: 'mail@example.test' },
						adm_none: { id, displayName: null, username: null, email: null },
					})[id] ?? null,
			},
		});
		h.file('med_pdf');
		link(h, 'shl_1', { createdBy: 'adm_user' });
		link(h, 'shl_2', { createdBy: 'adm_mail' });
		link(h, 'shl_3', { createdBy: 'adm_none' });
		const listed = await h.service.list('med_pdf', NOW);
		expect(listed.links.map((row) => row.createdByName)).toEqual(['ravi', 'mail@example.test', null]);
	});
});

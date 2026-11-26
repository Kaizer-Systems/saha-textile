import { describe, expect, it } from 'vitest';

import { PagePreviewService, tokenHash } from '../src/page-builder/page-preview.service';

/** Codes and sessions in memory, with the Mongo adapter's rules: a code once, before it expires. */
function memoryTokens() {
	const rows: {
		hash: string;
		kind: 'code' | 'session';
		layoutId: string;
		revisionId: string | null;
		expiresAt: string;
		usedAt: string | null;
	}[] = [];
	return {
		rows,
		createCode: async (input: {
			codeHash: string;
			layoutId: string;
			revisionId?: string | null;
			expiresAt: string;
		}) =>
			void rows.push({
				hash: input.codeHash,
				kind: 'code',
				layoutId: input.layoutId,
				revisionId: input.revisionId ?? null,
				expiresAt: input.expiresAt,
				usedAt: null,
			}),
		useCode: async (hash: string, now: string) => {
			const row = rows.find((r) => r.hash === hash && r.kind === 'code' && !r.usedAt && r.expiresAt > now);
			if (!row) return null;
			row.usedAt = now;
			return { layoutId: row.layoutId, revisionId: row.revisionId };
		},
		createSession: async (input: {
			tokenHash: string;
			layoutId: string;
			revisionId?: string | null;
			expiresAt: string;
		}) =>
			void rows.push({
				hash: input.tokenHash,
				kind: 'session',
				layoutId: input.layoutId,
				revisionId: input.revisionId ?? null,
				expiresAt: input.expiresAt,
				usedAt: null,
			}),
		findSession: async (hash: string, now: string) => {
			const row = rows.find((r) => r.hash === hash && r.kind === 'session' && r.expiresAt > now);
			return row ? { layoutId: row.layoutId, revisionId: row.revisionId } : null;
		},
	};
}

describe('preview (Page Builder step 6, FX-5)', () => {
	const layout = { id: 'lay_1', pageType: 'home', draftRevisionId: 'rev_2', lastLiveRevisionId: null };
	const setup = () => {
		const tokens = memoryTokens();
		const layouts = {
			layout: async (id: string) => (id === 'lay_1' ? layout : null),
			revision: async (id: string) =>
				id === 'rev_2' || id === 'rev_1' ? { id, layoutId: 'lay_1', sections: [] } : null,
		};
		const drawn: unknown[] = [];
		const builder = {
			shopLayout: async () => ({ settings: null }),
			drawn: async (...args: unknown[]) => {
				drawn.push(args);
				return { pageType: 'home', revisionId: 'rev_2', sections: [], refreshAt: null, settings: null };
			},
		};
		const service = new PagePreviewService(tokens as never, layouts as never, builder as never);
		return { service, tokens, drawn };
	};

	it('hands out a one-time code, stores only its hash, and swaps it once within its minute for an hour-long session', async () => {
		const { service, tokens } = setup();
		const t0 = new Date('2026-11-17T10:00:00.000Z');
		const { code, expiresAt } = await service.code('adm_1', 'lay_1', null, t0);
		expect(expiresAt).toBe('2026-11-17T10:01:00.000Z');
		expect(tokens.rows[0]?.hash).toBe(tokenHash(code));
		expect(tokens.rows.some((row) => row.hash === code)).toBe(false);
		const session = await service.exchange(code, new Date('2026-11-17T10:00:30.000Z'));
		expect(session).toMatchObject({ pageType: 'home', expiresAt: '2026-11-17T11:00:30.000Z' });
		await expect(service.exchange(code, new Date('2026-11-17T10:00:31.000Z'))).rejects.toMatchObject({
			status: 404,
		});
		await expect(service.code(null, 'lay_none', null, t0)).rejects.toMatchObject({ status: 404 });
	});

	it('refuses an expired code, and draws the draft only for a live session', async () => {
		const { service, drawn } = setup();
		const { code } = await service.code('adm_1', 'lay_1', null, new Date('2026-11-17T10:00:00.000Z'));
		await expect(service.exchange(code, new Date('2026-11-17T10:02:00.000Z'))).rejects.toMatchObject({
			status: 404,
		});
		const fresh = await service.code('adm_1', 'lay_1', null, new Date('2026-11-17T10:05:00.000Z'));
		const { token } = await service.exchange(fresh.code, new Date('2026-11-17T10:05:10.000Z'));
		expect((await service.layout(token, 'bn', new Date('2026-11-17T10:30:00.000Z'))).revisionId).toBe('rev_2');
		expect(drawn).toHaveLength(1);
		await expect(service.layout(token, 'bn', new Date('2026-11-17T11:10:00.000Z'))).rejects.toMatchObject({
			status: 404,
		});
		await expect(service.layout('x'.repeat(40), 'en')).rejects.toMatchObject({ status: 404 });
	});

	it("opens a saved revision instead of the draft for History's Look, and only a revision of that layout (E3)", async () => {
		const { service, drawn } = setup();
		const t0 = new Date('2026-11-17T10:00:00.000Z');
		await expect(service.code('adm_1', 'lay_1', 'rev_other', t0)).rejects.toMatchObject({ status: 404 });
		const { code } = await service.code('adm_1', 'lay_1', 'rev_1', t0);
		const { token } = await service.exchange(code, t0);
		await service.layout(token, 'en', t0);
		expect((drawn.at(-1) as unknown[])[1]).toMatchObject({ id: 'rev_1' });
	});
});

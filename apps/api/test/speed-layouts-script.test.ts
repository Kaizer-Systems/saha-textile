import { PageSection } from '@saha-textile/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The script runs on import; its database is a stand-in and nothing is read from `.env`. */
const h = vi.hoisted(() => ({
	existing: null as null | { draftRevisionId: string | null },
	saved: { id: 'rev_1' } as null | { id: string },
	home: null as null | { heroLayout?: string },
	calls: [] as string[],
	disconnect: vi.fn(async () => undefined),
}));
vi.mock('dotenv/config', () => ({}));
vi.mock('@saha-textile/adapters-db-mongo', () => ({
	connectMongo: async () => undefined,
	disconnectMongo: h.disconnect,
	MongoContentBlockRepository: class {
		list = async () => [];
	},
	MongoSiteSettingsRepository: class {
		get = async () => h.home;
	},
	MongoPageLayoutRepository: class {
		setSchedule = async () => void h.calls.push('setSchedule');
		layout = async () => h.existing;
		createLayout = async () => void h.calls.push('createLayout');
		saveDraft = async (input: { expectedDraftId: string | null }) => {
			h.calls.push(`saveDraft:${input.expectedDraftId}`);
			return h.saved;
		};
		goLive = async () => void h.calls.push('goLive');
	},
}));

class Exit extends Error {
	constructor(readonly code: number | undefined) {
		super(`exit ${code}`);
	}
}

const argv = process.argv;
afterEach(() => {
	process.argv = argv;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	h.calls.length = 0;
	h.existing = null;
	h.saved = { id: 'rev_1' };
	h.home = null;
	h.disconnect.mockClear();
});

/** Runs the script with these arguments; `throwOnExit` stops it where it would exit. */
async function run(args: string[], options: { database?: string; throwOnExit?: boolean } = {}) {
	vi.resetModules();
	process.argv = ['node', 'speed-layouts.js', ...args];
	vi.stubEnv('MONGODB_DB_NAME', options.database ?? 'saha_textile_e2e');
	const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
	const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
		if (options.throwOnExit) throw new Exit(code);
	}) as never);
	let failure: unknown = null;
	// The script runs on import; Vite resolves the .js name to the TypeScript file.
	const module = await import('../src/speed-layouts.js').catch((error: unknown) => {
		failure = error;
		return null;
	});
	return { out, err, exit, failure, module };
}

describe('the speed gate’s layouts script', () => {
	it('lists the cases, and shows how to use it for anything else', async () => {
		const listed = await run(['list'], { throwOnExit: true });
		expect(listed.out).toHaveBeenCalledWith(expect.stringContaining('current\n'));
		expect(listed.exit).toHaveBeenCalledWith(0);
		const wrong = await run(['live', 'nope'], { throwOnExit: true });
		expect(wrong.err).toHaveBeenCalledWith(expect.stringContaining('Usage: speed-layouts.js'));
		expect(wrong.exit).toHaveBeenCalledWith(2);
	});

	it('refuses any database but the e2e one', async () => {
		const { failure } = await run(['live', 'current'], { database: 'saha_textile_local' });
		expect(String(failure)).toContain('is not the e2e database');
		vi.unstubAllEnvs();
		const unset = await run(['live', 'current'], { database: '' });
		expect(String(unset.failure)).toContain('Refused');
	});

	it('puts Home back to its seeded page', async () => {
		const { out } = await run(['live', 'current']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.calls).toEqual(['setSchedule']);
		expect(out).toHaveBeenCalledWith('Home: as seeded\n');
	});

	it('makes the stress layout once and puts it live, and reuses a template layout already made', async () => {
		await run(['live', 'stress']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.calls).toEqual(['createLayout', 'saveDraft:null', 'goLive']);
		h.calls.length = 0;
		h.disconnect.mockClear();
		h.existing = { draftRevisionId: 'rev_0' };
		h.home = { heroLayout: 'hero_split' };
		await run(['live', 'today']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.calls).toEqual(['saveDraft:rev_0', 'goLive']);
	});

	it('stops with an error when the layout cannot be saved', async () => {
		h.saved = null;
		const { err, exit } = await run(['live', 'stress']);
		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
		expect(err).toHaveBeenCalledWith(expect.stringContaining('Could not save the stress layout'));
	});

	it('fills a stress page to fifteen sections, every banner sliding through ten pictures', async () => {
		const { module } = await run(['live', 'current']);
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		const stress = (module as { stressSections(base: PageSection[]): PageSection[] }).stressSections;
		const banner = PageSection.parse({
			id: 'hero',
			type: 'banner_arrangement',
			pieces: [
				{ name: 'main', pictures: [{ images: { desktop: 'med_1' }, versions: {}, alt: { en: 'a', bn: 'b' } }] },
			],
		});
		const newsletter = PageSection.parse({ id: 'news', type: 'newsletter', title: { en: 'Join', bn: 'যোগ দিন' } });
		const full = stress([banner, newsletter]);
		expect(full).toHaveLength(15);
		expect((full[0] as { pieces: Array<{ pictures: unknown[] }> }).pieces[0]?.pictures).toHaveLength(10);
		expect(full.filter((section) => section.type === 'newsletter')).toHaveLength(1);
		const empty = stress([
			PageSection.parse({ id: 'plain', type: 'banner_arrangement', pieces: [{ name: 'main', pictures: [] }] }),
		]);
		expect((empty[0] as { pieces: Array<{ pictures: unknown[] }> }).pieces[0]?.pictures).toEqual([]);
	});
});

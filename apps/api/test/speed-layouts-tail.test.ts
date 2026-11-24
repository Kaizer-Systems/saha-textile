import { afterEach, describe, expect, it, vi } from 'vitest';

/** The script runs on import; its database is a stand-in and nothing is read from `.env`. */
const h = vi.hoisted(() => ({
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
		get = async () => null;
	},
	MongoPageLayoutRepository: class {
		setSchedule = async () => void h.calls.push('setSchedule');
		layout = async () => null;
		createLayout = async (layout: { template: string | null }) =>
			void h.calls.push(`createLayout:${layout.template}`);
		saveDraft = async () => {
			h.calls.push('saveDraft');
			return { id: 'rev_1' };
		};
		goLive = async () => void h.calls.push('goLive');
	},
}));

const argv = process.argv;
afterEach(() => {
	process.argv = argv;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	h.calls.length = 0;
	h.disconnect.mockClear();
});

async function run(args: string[], database: string | undefined) {
	vi.resetModules();
	process.argv = ['node', 'speed-layouts.js', ...args];
	vi.stubEnv('MONGODB_DB_NAME', database);
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
	let failure: unknown = null;
	// The script runs on import; Vite resolves the .js name to the TypeScript file.
	await import('../src/speed-layouts.js').catch((error: unknown) => {
		failure = error;
	});
	return { failure };
}

describe('the speed gate’s layouts script: the last cases', () => {
	it('refuses when no database name is set at all', async () => {
		const { failure } = await run(['live', 'current'], undefined);
		expect(String(failure)).toContain('MONGODB_DB_NAME= is not the e2e database');
	});

	it('makes a template layout the first time, named for its template', async () => {
		await run(['live', 'today'], 'saha_textile_e2e');
		await vi.waitFor(() => expect(h.disconnect).toHaveBeenCalled());
		expect(h.calls).toEqual(['createLayout:today', 'saveDraft', 'goLive']);
	});
});

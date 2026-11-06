import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

type Repo = Record<string, Mock>;

/**
 * Every process entry point and local tool, run against mocks.
 *
 * `dotenv` and every adapter are replaced before a script loads, so nothing here can reach a
 * database, a queue, a bucket or the demo data on disk.
 */
interface Harness {
	customers: Repo;
	identities: Repo;
	adminAuth: Repo;
	customerAuth: Repo;
	products: Repo;
	assets: Repo;
	media: Repo;
	mongo: { connect: Mock; disconnect: Mock };
	nest: { create: Mock; context: Mock };
	worker: { close: Mock; compose: Mock };
	search: { rebuild: Mock; categories?: Mock };
	files: { read: Mock; write: Mock; mkdir: Mock };
	sharp: { metadata: Mock };
	queue: { close: Mock };
	config: Record<string, unknown>;
	boot: { failed: unknown[] };
	invite: { deliver: boolean };
	createApp: Mock;
	firstAdmin: Mock;
	format: Mock;
	purge: Mock;
	resolveImage: Mock;
	openapi: Mock;
}

const h = vi.hoisted(
	() =>
		({
			customers: {},
			identities: {},
			adminAuth: {},
			customerAuth: {},
			products: {},
			assets: {},
			media: {},
			mongo: {},
			nest: {},
			worker: {},
			search: {},
			files: {},
			sharp: {},
			queue: {},
			config: {},
			boot: { failed: [] },
			invite: { deliver: true },
		}) as unknown as Harness,
);

vi.mock('dotenv/config', () => ({}));
vi.mock('@saha-textile/adapters-db-mongo', () => {
	const repository = (target: () => object) =>
		class {
			constructor() {
				return target();
			}
		};
	const blank = repository(() => ({}));
	return {
		connectMongo: () => h.mongo.connect(),
		disconnectMongo: () => h.mongo.disconnect(),
		MongoCustomerRepository: repository(() => h.customers),
		MongoAuthIdentityRepository: repository(() => h.identities),
		MongoAdminUserAuthRepository: repository(() => h.adminAuth),
		MongoCustomerAuthRepository: repository(() => h.customerAuth),
		MongoProductRepository: repository(() => h.products),
		MongoMediaAssetRepository: repository(() => h.assets),
		MongoMediaRoleRepository: blank,
		MongoAdminInviteRepository: blank,
		MongoAdminUserRepository: blank,
		MongoAuditLogRepository: blank,
		MongoAuthRateLimitRepository: blank,
		MongoEmailVerificationTokenRepository: blank,
		MongoOtpChallengeRepository: blank,
		MongoPasswordResetTokenRepository: blank,
		MongoTransactionManager: blank,
		AdminUserModel: {},
		ADMINISTRATOR_ROLE_KEY: 'administrator',
		ensureSystemRoles: async () => undefined,
	};
});
vi.mock('@saha-textile/adapters-queue-bullmq', () => ({
	BullMqMediaJobQueue: class {
		close = () => h.queue.close();
	},
}));
vi.mock('@saha-textile/adapters-storage-spaces', () => ({
	SpacesStorageAdapter: class {
		getUrl = (key: string) => `cdn/${key}`;
	},
}));
vi.mock('@saha-textile/core-domain', async (original) => ({
	...(await original<object>()),
	rebuildSearchIndex: (...args: unknown[]) => h.search.rebuild(...args),
	purgeAsset: (...args: unknown[]) => h.purge(...args),
	resolveImage: (input: { getUrl: (key: string) => string }) => {
		input.getUrl('k');
		return h.resolveImage(input);
	},
}));
vi.mock('@nestjs/core', async (original) => ({
	...(await original<object>()),
	NestFactory: {
		create: (...args: unknown[]) => h.nest.create(...args),
		createApplicationContext: (...args: unknown[]) => h.nest.context(...args),
	},
}));
vi.mock('node:fs/promises', () => ({
	readFile: (...args: unknown[]) => h.files.read(...args),
	writeFile: (...args: unknown[]) => h.files.write(...args),
	mkdir: (...args: unknown[]) => h.files.mkdir(...args),
}));
vi.mock('prettier', () => ({
	resolveConfig: async () => ({}),
	format: (...args: unknown[]) => h.format(...args),
}));
vi.mock('sharp', () => ({ default: () => ({ metadata: () => h.sharp.metadata() }) }));
vi.mock('../src/app.module', () => ({ AppModule: { forRoot: () => 'module' } }));
vi.mock('../src/config/app-config', () => ({ loadConfig: () => h.config }));
vi.mock('../src/config/boot-failure', () => ({
	exitOnDeploymentConfigError: (error: unknown) => h.boot.failed.push(error),
}));
vi.mock('../src/bootstrap', () => ({ createApp: (...args: unknown[]) => h.createApp(...args) }));
vi.mock('../src/worker/media-worker', () => ({
	composeMediaWorker: (...args: unknown[]) => h.worker.compose(...args),
}));
vi.mock('../src/search/meilisearch-search', () => ({
	MeilisearchSearch: class {
		constructor(_host: string, _key: string, categories: () => Promise<unknown[]>) {
			h.search.categories = vi.fn(categories);
		}
	},
}));
vi.mock('../src/openapi', () => ({ createOpenApiDocument: (...args: unknown[]) => h.openapi(...args) }));
vi.mock('../src/infra/argon2-jwt.auth', () => ({
	Argon2JwtAuth: class {
		hashPassword = async (value: string) => `hash:${value}`;
	},
}));
vi.mock('../src/auth/auth.service', () => ({ AuthService: class {} }));
vi.mock('../src/auth/admin-invite.service', () => ({
	AdminInviteService: class {
		constructor(...parts: unknown[]) {
			this.notifications = parts[5] as typeof this.notifications;
		}
		notifications: {
			send: (message: unknown) => Promise<unknown>;
			isChannelEnabled: () => Promise<boolean>;
		};
		async create(input: { request: { email: string; role: string } }) {
			await this.notifications.isChannelEnabled();
			if (h.invite.deliver) await this.notifications.send({ variables: { token: 'tok_1' } });
			return { emailNormalized: input.request.email, role: input.request.role, expiresAt: 'soon' };
		}
	},
}));
vi.mock('../src/media/media.service', () => ({
	MediaService: class {
		constructor(...parts: unknown[]) {
			h.media.audit = parts[4] as never;
			return h.media;
		}
	},
}));
vi.mock('../src/first-admin', () => ({
	FirstAdminAlreadyExistsError: class extends Error {},
	bootstrapFirstAdmin: (...args: unknown[]) => h.firstAdmin(...args),
}));

const scripts = {
	main: () => import('../src/main.js'),
	worker: () => import('../src/worker.js'),
	rebuild: () => import('../src/rebuild-search-index.js'),
	openapi: () => import('../src/generate-openapi.js'),
	firstAdmin: () => import('../src/create-first-admin.js'),
	reset: () => import('../src/reset-local-customer.js'),
	invite: () => import('../src/invite-local-admin.js'),
	credentials: () => import('../src/set-local-test-credentials.js'),
	accounts: () => import('../src/seed-local-auth-accounts.js'),
	photos: () => import('../src/seed-local-catalog-photos.js'),
};

const heldArgv = process.argv;
let out = '';
let err = '';

const flush = async () => {
	for (let i = 0; i < 6; i += 1) await new Promise((done) => setImmediate(done));
};

const run = async (script: keyof typeof scripts, argv: string[] = [], env: Record<string, string | undefined> = {}) => {
	vi.resetModules();
	process.argv = ['node', script, ...argv];
	for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value as string);
	await scripts[script]();
	await flush();
	return { out, err, code: process.exitCode };
};

beforeEach(() => {
	out = '';
	err = '';
	vi.spyOn(process.stdout, 'write').mockImplementation(((text: string) => ((out += text), true)) as never);
	vi.spyOn(process.stderr, 'write').mockImplementation(((text: string) => ((err += text), true)) as never);
	vi.stubEnv('NODE_ENV', 'development');
	vi.stubEnv('MONGODB_HOST', '127.0.0.1');
	vi.stubEnv('MONGODB_DB_NAME', 'shop_local');
	h.mongo.connect = vi.fn(async () => undefined);
	h.mongo.disconnect = vi.fn(async () => undefined);
	h.queue.close = vi.fn(async () => undefined);
	h.config = {};
});

afterEach(() => {
	process.argv = heldArgv;
	process.exitCode = undefined;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('local-only refusals', () => {
	const tools = [
		['reset', 'reset-local-customer failed'],
		['invite', 'invite-local-admin failed'],
		['credentials', 'set-local-test-credentials failed'],
		['accounts', 'seed-local-auth-accounts failed'],
	] as const;

	it.each(tools)('%s needs the local flag', async (script, prefix) => {
		const result = await run(script);
		expect(result.err).toContain(`${prefix}: Refused: pass --i-am-local`);
		expect(result.code).toBe(1);
		expect(h.mongo.connect).not.toHaveBeenCalled();
	});

	it.each(tools)('%s refuses production', async (script) => {
		const result = await run(script, ['--i-am-local'], { NODE_ENV: 'production' });
		expect(result.err).toContain('Refused: NODE_ENV=production.');
	});

	it.each(tools)('%s refuses a remote database', async (script) => {
		const result = await run(script, ['--i-am-local'], { MONGODB_HOST: 'Db.Example.Test' });
		expect(result.err).toContain('Refused: MONGODB_HOST=db.example.test is not a loopback host.');
	});

	it.each(tools)('%s treats an unset host as local', async (script) => {
		const result = await run(script, ['--i-am-local'], { MONGODB_HOST: '' });
		expect(result.err).not.toContain('loopback');
	});
});

describe('main', () => {
	const listen = () => {
		const app = { listen: vi.fn(async () => undefined) };
		h.createApp = vi.fn(async () => app);
		return app;
	};
	const logged = async () => {
		const { Logger } = await import('@nestjs/common');
		return {
			log: vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
			warn: vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
		};
	};

	it('listens, announcing a local run with a label', async () => {
		const app = listen();
		const { log } = await logged();
		h.config = { port: 3000, nodeEnv: 'development', deployEnv: 'local', otp: {} };
		await run('main');
		expect(app.listen).toHaveBeenCalledWith({ port: 3000, host: '0.0.0.0' });
		expect(log).toHaveBeenCalledWith('Non-strict environment (NODE_ENV=development, DEPLOY_ENV=local).');
	});

	it('announces a local run with no label, and warns about a fixed code', async () => {
		listen();
		const { log, warn } = await logged();
		h.config = { port: 3000, nodeEnv: 'test', otp: { localFixedCode: '123456' } };
		await run('main');
		expect(log).toHaveBeenCalledWith('Non-strict environment (NODE_ENV=test).');
		expect(warn).toHaveBeenCalledOnce();
	});

	it('announces a strict deployment, labelled or by default', async () => {
		listen();
		const { log } = await logged();
		h.config = { port: 3000, nodeEnv: 'production', deployEnv: 'staging', otp: {} };
		await run('main');
		expect(log).toHaveBeenCalledWith('Strict deployment (staging): hardening checks passed.');
		h.config = { port: 3000, nodeEnv: 'production', otp: {} };
		await run('main');
		expect(log).toHaveBeenCalledWith('Strict deployment (production by default): hardening checks passed.');
	});

	it('hands a failed boot to the boot-failure handler', async () => {
		const failure = new Error('boot');
		h.boot.failed.length = 0;
		h.createApp = vi.fn(async () => {
			throw failure;
		});
		await logged();
		h.config = { port: 3000, nodeEnv: 'test', otp: {} };
		await run('main');
		expect(h.boot.failed).toEqual([failure]);
	});
});

describe('worker', () => {
	it.each(['SIGTERM', 'SIGINT'])('finishes its jobs on %s', async (signal) => {
		const { Logger } = await import('@nestjs/common');
		vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		const handlers = new Map<string, () => void>();
		vi.spyOn(process, 'once').mockImplementation(((name: string, handler: () => void) => {
			handlers.set(name, handler);
			return process;
		}) as never);
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		h.worker.close = vi.fn(async () => undefined);
		h.worker.compose = vi.fn(async () => ({ close: h.worker.close }));
		await run('worker');
		expect(h.mongo.connect).toHaveBeenCalledOnce();
		handlers.get(signal)?.();
		await flush();
		expect(h.worker.close).toHaveBeenCalledOnce();
		expect(h.mongo.disconnect).toHaveBeenCalledOnce();
		expect(exit).toHaveBeenCalledWith(0);
	});
});

describe('rebuild-search-index', () => {
	beforeEach(() => {
		h.config = { search: { host: 'http://search', apiKey: 'k' } };
		h.search.rebuild = vi.fn(async (products: unknown[]) => products.length);
	});

	it('reads every page and stops at the total', async () => {
		h.products.list = vi
			.fn()
			.mockResolvedValueOnce({ items: [1], total: 2 })
			.mockResolvedValueOnce({ items: [2], total: 2 });
		const result = await run('rebuild');
		expect(h.products.list).toHaveBeenCalledTimes(2);
		expect(result.out).toContain('Indexed 2 live products of 2.');
		await expect(h.search.categories?.()).resolves.toEqual([]);
		expect(h.mongo.disconnect).toHaveBeenCalledOnce();
	});

	it('stops at an empty page', async () => {
		h.products.list = vi.fn().mockResolvedValue({ items: [], total: 5 });
		const result = await run('rebuild');
		expect(result.out).toContain('of 0.');
	});

	it.each([
		[new Error('down'), 'down'],
		['text', 'text'],
	])('reports a failure', async (failure, text) => {
		h.products.list = vi.fn().mockRejectedValue(failure);
		const result = await run('rebuild');
		expect(result.err).toBe(`${text}\n`);
		expect(result.code).toBe(1);
		expect(h.mongo.disconnect).toHaveBeenCalledOnce();
	});
});

describe('generate-openapi', () => {
	const app = () => ({ init: vi.fn(async () => undefined), close: vi.fn(async () => undefined) });

	beforeEach(() => {
		h.openapi = vi.fn(() => ({ openapi: '3' }));
		h.files.mkdir = vi.fn(async () => undefined);
		h.files.write = vi.fn(async () => undefined);
	});

	it('writes to the default path', async () => {
		const parts = app();
		h.nest.create = vi.fn(async () => parts);
		const result = await run('openapi');
		expect(h.openapi).toHaveBeenCalledWith(parts, undefined);
		expect(String(h.files.write.mock.calls[0]?.[0])).toMatch(/dist\/openapi\.json$/);
		expect(result.out).toContain('Generated scaffolded OpenAPI document');
		expect(parts.close).toHaveBeenCalledOnce();
	});

	it('takes an output path and a server', async () => {
		h.nest.create = vi.fn(async () => app());
		await run('openapi', ['--output', '/tmp/x.json', '--server', 'https://api.example.test']);
		expect(h.files.write.mock.calls[0]?.[0]).toBe('/tmp/x.json');
		expect(h.openapi.mock.calls[0]?.[1]).toBe('https://api.example.test');
	});
});

describe('create-first-admin', () => {
	const context = () => ({ init: vi.fn(async () => undefined), close: vi.fn(async () => undefined) });

	it.each([[[]], [['--email', 'not-an-address']]])('needs an address %#', async (argv) => {
		const result = await run('firstAdmin', argv);
		expect(result.err).toContain('Usage: bootstrap:first-admin');
		expect(result.code).toBe(1);
	});

	it('prints the credential once', async () => {
		const app = context();
		h.nest.context = vi.fn(async () => app);
		h.firstAdmin = vi.fn(async () => ({ email: 'a@b.co', password: 'pw', roleKey: 'administrator' }));
		const result = await run('firstAdmin', ['--email', 'a@b.co']);
		expect(result.out).toContain('password: pw');
		expect(app.close).toHaveBeenCalledOnce();
	});

	it('says plainly when one already exists', async () => {
		h.nest.context = vi.fn(async () => context());
		h.firstAdmin = vi.fn(async () => {
			const { FirstAdminAlreadyExistsError } = await import('../src/first-admin.js');
			throw new FirstAdminAlreadyExistsError('already');
		});
		const result = await run('firstAdmin', ['--email', 'a@b.co']);
		expect(result.err).toContain('Refused: already');
		expect(result.code).toBe(1);
	});

	it.each([
		[new Error('down'), 'down'],
		['text', 'text'],
	])('reports any other failure', async (failure, text) => {
		h.nest.context = vi.fn(async () => context());
		h.firstAdmin = vi.fn(async () => {
			throw failure;
		});
		const result = await run('firstAdmin', ['--email', 'a@b.co']);
		expect(result.err).toContain(`first-admin bootstrap failed: ${text}`);
	});
});

describe('reset-local-customer', () => {
	beforeEach(() => {
		h.customers.findByEmail = vi.fn(async () => ({ id: 'c1' }));
		h.customers.findByPhone = vi.fn(async () => ({ id: 'c2' }));
		h.customers.setStatus = vi.fn(async () => undefined);
		h.identities.listForSubject = vi.fn(async () => []);
		h.identities.unlink = vi.fn(async () => true);
	});

	it('needs an address, ignoring a flag with no value', async () => {
		const result = await run('reset', ['--i-am-local', '--email']);
		expect(result.err).toContain('Usage: reset:local-customer');
		expect(result.code).toBe(1);
		expect(h.mongo.connect).not.toHaveBeenCalled();
	});

	it('resets matches and unlinks their providers', async () => {
		h.identities.listForSubject = vi.fn(async (_type: string, id: string) =>
			id === 'c1' ? [{ provider: 'google' }] : [],
		);
		const result = await run('reset', ['--i-am-local', '--email', ' A@B.CO ', '--phone', ' +91 ']);
		expect(h.customers.findByEmail).toHaveBeenCalledWith('a@b.co');
		expect(h.customers.findByPhone).toHaveBeenCalledWith('+91');
		expect(h.identities.unlink).toHaveBeenCalledWith('customer', 'c1', 'google');
		expect(result.out).toContain('unlinked: google');
		expect(result.out).toContain('unlinked: none');
		expect(h.customers.setStatus).toHaveBeenCalledTimes(2);
	});

	it('says when nothing matched', async () => {
		h.customers.findByEmail = vi.fn(async () => null);
		h.customers.findByPhone = vi.fn(async () => null);
		const result = await run('reset', ['--i-am-local', '--email', 'a@b.co', '--phone', '+91']);
		expect(result.out).toContain('No live customer matched');
		expect(h.mongo.disconnect).toHaveBeenCalledOnce();
	});

	it('reports a failure given as text', async () => {
		h.customers.findByEmail = vi.fn(async () => {
			throw 'text';
		});
		const result = await run('reset', ['--i-am-local', '--email', 'a@b.co']);
		expect(result.err).toContain('reset-local-customer failed: text');
	});
});

describe('invite-local-admin', () => {
	beforeEach(() => {
		h.invite.deliver = true;
	});

	it('needs a local database name', async () => {
		const named = await run('invite', ['--i-am-local'], { MONGODB_DB_NAME: 'shop' });
		expect(named.err).toContain('MONGODB_DB_NAME must end in _local');
		err = '';
		const unset = await run('invite', ['--i-am-local'], { MONGODB_DB_NAME: undefined });
		expect(unset.err).toContain('MONGODB_DB_NAME must end in _local');
	});

	it.each([[[]], [['--email', 'nope']]])('needs an address %#', async (argv) => {
		const result = await run('invite', ['--i-am-local', ...argv]);
		expect(result.err).toContain('Refused: --email is required.');
	});

	it('prints the link, by default on the local admin host', async () => {
		const result = await run('invite', ['--i-am-local', '--email', 'a@b.co']);
		expect(result.out).toContain('https://localhost:4300/auth/accept-invite?token=tok_1');
		expect(result.out).toContain('role:    staff');
		expect(h.mongo.disconnect).toHaveBeenCalledOnce();
	});

	it('takes a role and a host', async () => {
		const result = await run('invite', [
			'--i-am-local',
			'--email',
			'a@b.co',
			'--role',
			'admin',
			'--admin-url',
			'https://admin.example.test',
		]);
		expect(result.out).toContain('https://admin.example.test/auth/accept-invite');
		expect(result.out).toContain('role:    admin');
	});

	it('notices a token that never arrived', async () => {
		h.invite.deliver = false;
		const result = await run('invite', ['--i-am-local', '--email', 'a@b.co']);
		expect(result.err).toContain('no token was captured');
	});

	it('reports a failure given as text', async () => {
		h.mongo.connect = vi.fn(async () => {
			throw 'text';
		});
		const result = await run('invite', ['--i-am-local', '--email', 'a@b.co']);
		expect(result.err).toContain('invite-local-admin failed: text');
	});
});

describe('set-local-test-credentials', () => {
	const strong = 'correct-horse-battery-staple-9';
	const base = ['--i-am-local', '--email', ' A@B.CO '];

	beforeEach(() => {
		Object.assign(h.adminAuth, {
			findAuthStateByIdentifier: vi.fn(async () => ({ id: 'adm_1', status: 'active' }) as unknown),
			setPasswordHash: vi.fn(async () => undefined),
			bumpTokenVersion: vi.fn(async () => 1),
			setStatus: vi.fn(async () => undefined),
			setPinHash: vi.fn(async () => undefined),
		});
		Object.assign(h.customerAuth, {
			findAuthStateByEmail: vi.fn(async () => ({ id: 'cus_1', status: 'active' }) as unknown),
			setPasswordHash: vi.fn(async () => undefined),
			bumpTokenVersion: vi.fn(async () => 1),
			setStatus: vi.fn(async () => undefined),
		});
	});

	it('needs a known audience', async () => {
		const result = await run('credentials', ['--i-am-local', '--audience', 'other']);
		expect(result.err).toContain('Usage: set:local-credentials');
		expect(result.code).toBe(1);
	});

	it.each([[[]], [['--email', 'nope']]])('needs an address %#', async (argv) => {
		const result = await run('credentials', ['--i-am-local', '--audience', 'admin', ...argv]);
		expect(result.err).toContain('Refused: --email is required.');
	});

	it('refuses a weak password', async () => {
		const result = await run('credentials', [...base, '--audience', 'admin', '--password', 'short']);
		expect(result.err).toContain('Refused: password policy');
		expect(h.mongo.connect).not.toHaveBeenCalled();
	});

	it('refuses a badly formed PIN', async () => {
		const result = await run('credentials', [...base, '--audience', 'admin', '--pin', '12']);
		expect(result.err).toContain('PIN must be exactly 6 digits.');
	});

	it('refuses a PIN for a customer', async () => {
		const result = await run('credentials', [...base, '--audience', 'storefront', '--pin', '482916']);
		expect(result.err).toContain('--pin is only valid for --audience admin');
	});

	it('refuses an unknown operator', async () => {
		h.adminAuth.findAuthStateByIdentifier = vi.fn(async () => null);
		const result = await run('credentials', [...base, '--audience', 'admin']);
		expect(result.err).toContain('Refused: no admin user for a@b.co.');
		expect(h.mongo.disconnect).toHaveBeenCalledOnce();
	});

	it('rotates an operator with a generated password', async () => {
		const result = await run('credentials', [...base, '--audience', 'admin']);
		expect(h.adminAuth.setPasswordHash).toHaveBeenCalledOnce();
		expect(h.adminAuth.setStatus).not.toHaveBeenCalled();
		expect(h.adminAuth.setPinHash).not.toHaveBeenCalled();
		expect(result.out).toContain('password: local-');
		expect(result.out).not.toContain('pin:');
	});

	it('rotates a locked operator with a PIN', async () => {
		h.adminAuth.findAuthStateByIdentifier = vi.fn(async () => ({ id: 'adm_1', status: 'locked' }));
		const result = await run('credentials', [
			...base,
			'--audience',
			'admin',
			'--password',
			strong,
			'--pin',
			'482916',
		]);
		expect(h.adminAuth.setStatus).toHaveBeenCalledWith('adm_1', 'active');
		expect(h.adminAuth.setPinHash).toHaveBeenCalledWith('adm_1', 'hash:482916');
		expect(result.out).toContain('pin:      482916');
	});

	it('refuses an unknown customer', async () => {
		h.customerAuth.findAuthStateByEmail = vi.fn(async () => null);
		const result = await run('credentials', [...base, '--audience', 'storefront']);
		expect(result.err).toContain('Refused: no customer for a@b.co.');
	});

	it('rotates a customer, activating one that was not', async () => {
		const active = await run('credentials', [...base, '--audience', 'storefront']);
		expect(active.out).toContain('Local customer credentials rotated');
		expect(h.customerAuth.setStatus).not.toHaveBeenCalled();
		h.customerAuth.findAuthStateByEmail = vi.fn(async () => ({ id: 'cus_1', status: 'pending' }));
		await run('credentials', [...base, '--audience', 'storefront']);
		expect(h.customerAuth.setStatus).toHaveBeenCalledWith('cus_1', 'active');
	});

	it('reports a failure given as text', async () => {
		h.mongo.connect = vi.fn(async () => {
			throw 'text';
		});
		const result = await run('credentials', [...base, '--audience', 'admin']);
		expect(result.err).toContain('set-local-test-credentials failed: text');
	});
});

describe('seed-local-auth-accounts', () => {
	const context = () => {
		const tokens = {
			hashPassword: vi.fn(async () => 'hashed'),
			findByEmail: vi.fn(async () => null as unknown),
			setStatus: vi.fn(async () => undefined),
			create: vi.fn(async (row: unknown) => row),
			setPasswordHash: vi.fn(async () => undefined),
			findByProviderSubject: vi.fn(async () => null as unknown),
			unlink: vi.fn(async () => true),
		};
		const app = {
			init: vi.fn(async () => undefined),
			get: vi.fn(() => tokens),
			close: vi.fn(async () => undefined),
		};
		h.nest.context = vi.fn(async () => app);
		return { app, tokens };
	};

	it('creates every shape of account', async () => {
		const { app, tokens } = context();
		const result = await run('accounts', ['--i-am-local']);
		expect(tokens.create).toHaveBeenCalledTimes(7);
		expect(tokens.setStatus).toHaveBeenCalledTimes(2);
		const rows = tokens.create.mock.calls.map((call) => call[0] as { addresses: unknown[]; identities: unknown[] });
		expect(rows.map((row) => row.addresses.length)).toEqual([1, 0, 0, 0, 2, 0, 0]);
		expect(rows.map((row) => row.identities.length)).toEqual([0, 1, 1, 2, 2, 0, 0]);
		expect(result.out).toContain('password + google + facebook');
		expect(app.close).toHaveBeenCalledOnce();
	});

	it('retires earlier rows and releases held provider subjects', async () => {
		const { tokens } = context();
		tokens.findByEmail.mockResolvedValue({ id: 'old' });
		tokens.findByProviderSubject.mockResolvedValue({
			subjectType: 'customer',
			subjectId: 'old',
			provider: 'google',
		});
		await run('accounts', ['--i-am-local']);
		expect(tokens.setStatus).toHaveBeenCalledWith('old', 'deleted');
		expect(tokens.unlink).toHaveBeenCalledWith('customer', 'old', 'google');
	});

	it('reports a failure given as text', async () => {
		const { app } = context();
		app.init.mockRejectedValue('text');
		const result = await run('accounts', ['--i-am-local']);
		expect(result.err).toContain('seed-local-auth-accounts failed: text');
		expect(app.close).toHaveBeenCalledOnce();
	});
});

describe('seed-local-catalog-photos', () => {
	const spaces = { key: 'k', secret: 's', bucket: 'b', region: 'r', endpoint: 'e', cdnUrl: 'c' };
	const demo = () =>
		JSON.stringify({
			count: 1,
			data: [
				{
					id: 1,
					slug: 'a',
					product_thumbnail: { original_url: 'x', image: { old: true } },
					product_galleries: [{ original_url: 'y' }, null, [], { other: 1 }],
					variation_image: 'text',
					related: [{ product_id: 2, product_thumbnail: { original_url: 'z' } }],
				},
				{ id: 9, product_thumbnail: { original_url: 'no-slug' } },
			],
		});
	const image = (roles: Record<string, unknown> = {}) => ({
		roles: {
			card: [{ width: 400, url: 'card.jpg' }],
			thumb: [{ width: 200, url: 'small.jpg' }],
			gallery: [{ width: 800, url: 'gallery.jpg' }],
			...roles,
		},
	});
	const written = (name: string) => {
		const call = h.files.write.mock.calls.find((row) => String(row[0]).endsWith(name));
		return JSON.parse(String(call?.[1])) as { data: Array<Record<string, never>> };
	};

	beforeEach(() => {
		h.config = { spaces, redis: {} };
		h.files.read = vi.fn(async (path: string) => (String(path).endsWith('.json') ? demo() : Buffer.from('photo')));
		h.files.write = vi.fn(async () => undefined);
		h.format = vi.fn(async (text: string) => text);
		h.sharp.metadata = vi.fn(async () => ({ width: 300, height: 400 }));
		h.purge = vi.fn(async () => undefined);
		h.resolveImage = vi.fn(() => image());
		h.assets.findManyByIds = vi.fn(async () => [{ id: 'med_1' }]);
		Object.assign(h.media, {
			presign: vi.fn(async () => ({ assetId: 'med_1', uploadUrl: 'https://u', headers: {} })),
			finalize: vi.fn(async () => undefined),
			status: vi.fn(async () => ({ state: 'ready' })),
			library: vi.fn(async () => ({
				items: [{ asset: { slug: 'local-catalog-photo-1' } }, { asset: { slug: 'somebody-else' } }],
			})),
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({})),
		);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => vi.unstubAllGlobals());

	const failure = () => vi.mocked(console.error).mock.calls[0]?.[0] as Error;

	it.each([
		['the local flag', [], {}, 'Pass --i-am-local'],
		['production', ['--i-am-local'], { NODE_ENV: 'production' }, 'NODE_ENV=production'],
		['a remote database', ['--i-am-local'], { MONGODB_HOST: 'db.example.test' }, 'not a loopback host'],
		['a local database name', ['--i-am-local'], { MONGODB_DB_NAME: 'shop' }, 'must end in _local'],
		['any database name', ['--i-am-local'], { MONGODB_DB_NAME: undefined }, 'must end in _local'],
	])('refuses without %s', async (_name, argv, env, text) => {
		await expect(run('photos', argv, env)).rejects.toThrow(text);
	});

	it.each([
		['key', { ...spaces, key: '' }],
		['secret', { ...spaces, secret: '' }],
		['bucket', { ...spaces, bucket: '' }],
	])('needs the Spaces %s', async (_name, value) => {
		h.config = { spaces: value };
		await expect(run('photos', ['--i-am-local'])).rejects.toThrow('Spaces credentials are required');
	});

	it('treats an unset host as local', async () => {
		await run('photos', ['--i-am-local', '--clean'], { MONGODB_HOST: '' });
		expect(h.mongo.connect).toHaveBeenCalledOnce();
	});

	it('needs a photo', async () => {
		await run('photos', ['--i-am-local']);
		expect(failure().message).toContain('Pass at least one photo');
		expect(process.exitCode).toBe(1);
		expect(h.queue.close).toHaveBeenCalledOnce();
	});

	it('cleans only its own assets and restores the placeholder', async () => {
		await run('photos', ['--i-am-local', '--clean']);
		expect(h.purge).toHaveBeenCalledOnce();
		await expect(
			(h.media.audit as unknown as { append: (row: string) => Promise<string> }).append('row'),
		).resolves.toBe('row');
		const product = written('product.json').data[0] as Record<string, { original_url: string; image?: unknown }>;
		expect(product['product_thumbnail']?.original_url).toBe('assets/images/data/product.png');
		expect(product['product_thumbnail']?.image).toBeUndefined();
	});

	it('dresses the data from uploaded assets', async () => {
		await run('photos', ['--i-am-local', '--assets=med_1,med_2']);
		expect(h.files.write).toHaveBeenCalledTimes(6);
		const product = written('product.json').data[0] as Record<
			string,
			{ original_url: string; image?: { roles: object } }
		>;
		expect(product['product_thumbnail']?.original_url).toBe('card.jpg');
		expect(Object.keys(product['product_thumbnail']?.image?.roles ?? {})).toEqual(['card']);
		const gallery = product['product_galleries'] as unknown as Array<{
			image: { roles: Record<string, unknown[]> };
		}>;
		expect(gallery[0]?.image.roles).toEqual({ gallery: [{ width: 800, url: 'gallery.jpg' }], zoom: [] });
		const cart = written('cart.json').data[0] as Record<string, { original_url: string; image?: unknown }>;
		expect(cart['product_thumbnail']?.original_url).toBe('small.jpg');
		expect(cart['product_thumbnail']?.image).toBeUndefined();
		const compare = written('compare.json').data[0] as Record<string, { original_url: string; image?: unknown }>;
		expect(compare['product_thumbnail']?.original_url).toBe('card.jpg');
		expect(compare['product_thumbnail']?.image).toBeUndefined();
	});

	it.each([
		['a missing asset', () => (h.assets.findManyByIds = vi.fn(async () => []))],
		['a missing card', () => (h.resolveImage = vi.fn(() => image({ card: undefined })))],
		['a missing thumb', () => (h.resolveImage = vi.fn(() => image({ thumb: [] })))],
		['no resolved image', () => (h.resolveImage = vi.fn(() => null))],
	])('refuses %s', async (_name, arrange) => {
		arrange();
		await run('photos', ['--i-am-local', '--assets=med_1']);
		expect(failure().message).toContain('missing public card/thumb derivatives');
	});

	it('uploads a photo through the pipeline', async () => {
		await run('photos', ['--i-am-local', 'a.JPG'], { INIT_CWD: '/photos' });
		expect(h.files.read).toHaveBeenCalledWith('/photos/a.JPG');
		expect(h.media.presign).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ contentType: 'image/jpeg', fileName: 'local-catalog-photo-1.jpg' }),
		);
		expect(fetch).toHaveBeenCalledOnce();
		expect(console.log).toHaveBeenCalledWith('a.JPG → med_1');
	});

	it('uses the working directory without INIT_CWD', async () => {
		await run('photos', ['--i-am-local', 'b.png'], { INIT_CWD: undefined });
		expect(String(h.files.read.mock.calls[0]?.[0])).toBe(`${process.cwd()}/b.png`);
	});

	it('refuses an unsupported type or an unreadable image', async () => {
		await run('photos', ['--i-am-local', 'c.heic']);
		expect(failure().message).toContain('c.heic: convert it to JPEG first');
		vi.mocked(console.error).mockClear();
		h.sharp.metadata = vi.fn(async () => ({ width: 0, height: 10 }));
		await run('photos', ['--i-am-local', 'd.jpeg']);
		expect(failure().message).toContain('d.jpeg: unreadable image');
		vi.mocked(console.error).mockClear();
		h.sharp.metadata = vi.fn(async () => ({ width: 10, height: 0 }));
		await run('photos', ['--i-am-local', 'e.jpeg']);
		expect(failure().message).toContain('e.jpeg: unreadable image');
	});

	it('reports a failed encode', async () => {
		h.media.status = vi.fn(async () => ({ state: 'failed', error: 'bad' }));
		await run('photos', ['--i-am-local', 'a.jpg']);
		expect(failure().message).toContain('a.jpg: processing failed: bad');
	});

	it('gives up on a worker that never finishes', async () => {
		h.media.status = vi.fn(async () => ({ state: 'processing' }));
		vi.spyOn(globalThis, 'setTimeout').mockImplementation(((settle: () => void) => {
			settle();
			return 0;
		}) as never);
		await run('photos', ['--i-am-local', 'a.jpg']);
		expect(h.media.status).toHaveBeenCalledTimes(180);
		expect(failure().message).toContain('worker did not finish');
	});
});

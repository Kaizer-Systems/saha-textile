import { beforeEach, expect, it, vi } from 'vitest';

const build = vi.hoisted(() => ({
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	templates: [],
	log: vi.fn(),
	error: vi.fn(),
}));

vi.mock('node:fs/promises', async (original) => ({
	...(await original()),
	mkdir: build.mkdir,
	writeFile: build.writeFile,
}));
vi.mock('../src/templates.mjs', () => ({ TEMPLATES: build.templates, render: (template) => template.html }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	build.templates.length = 0;
});

async function runBuild() {
	const previousCode = process.exitCode;
	const log = vi.spyOn(console, 'log').mockImplementation(build.log);
	const error = vi.spyOn(console, 'error').mockImplementation(build.error);
	try {
		process.exitCode = undefined;
		await import('../src/build.mjs');
		return process.exitCode;
	} finally {
		process.exitCode = previousCode;
		log.mockRestore();
		error.mockRestore();
	}
}

it('writes a registrable file and leaves the environment tokens in place', async () => {
	const html = '<a href="[[shop_origin]]">Order details</a>';
	build.templates.push({ name: 'receipt', subject: 'Receipt', html });
	await expect(runBuild()).resolves.toBeUndefined();
	expect(build.mkdir).toHaveBeenCalledWith(expect.stringMatching(/[/\\]dist$/), { recursive: true });
	expect(build.writeFile).toHaveBeenCalledExactlyOnceWith(
		expect.stringMatching(/[/\\]dist[/\\]receipt_v1\.html$/),
		html,
	);
	expect(build.log).toHaveBeenCalledWith('1 templates written to dist/');
});

it('returns an error status and identifies invalid body and subject markup', async () => {
	build.templates.push({ name: 'receipt', subject: '{{> heading}}', html: '<img src="relative.png">' });
	await expect(runBuild()).resolves.toBe(1);
	expect(build.error).toHaveBeenCalledWith(
		'receipt: an image without an absolute address\nreceipt subject: “>” (partials, inverse) is not supported',
	);
	expect(build.log).not.toHaveBeenCalled();
});

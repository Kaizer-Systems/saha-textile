import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnconfiguredStorageAdapter } from '../src/infra/unconfigured-storage.adapter';

describe('storage without Spaces settings', () => {
	it('refuses every call, saying what to set', async () => {
		const storage = new UnconfiguredStorageAdapter();
		const refused = /Object storage is not configured/;
		await expect(storage.startMultipartUpload()).rejects.toThrow(refused);
		await expect(storage.createSignedPartUrl()).rejects.toThrow(refused);
		await expect(storage.listUploadedParts()).rejects.toThrow(refused);
		await expect(storage.completeMultipartUpload()).rejects.toThrow(refused);
		await expect(storage.abortMultipartUpload()).rejects.toThrow(refused);
		await expect(storage.uploadStream()).rejects.toThrow(refused);
		expect(() => storage.readStream()).toThrow(refused);
		await expect(storage.listKeys()[Symbol.asyncIterator]().next()).rejects.toThrow(refused);
	});
});

describe('the language manifest written at build time', () => {
	afterEach(() => {
		vi.doUnmock('../src/languages/shipped-languages');
		vi.doUnmock('node:fs');
		vi.restoreAllMocks();
		vi.resetModules();
	});

	const run = async (root: string | null) => {
		const writeFileSync = vi.fn();
		vi.resetModules();
		vi.doMock('node:fs', async (original) => ({ ...(await original<typeof import('node:fs')>()), writeFileSync }));
		vi.doMock('../src/languages/shipped-languages', () => ({
			MANIFEST_FILE: 'shipped-languages.json',
			repositoryRoot: () => root,
			manifestFromRepository: () => ({ admin: { en: 1, bn: 1 }, shop: { en: 1 } }),
		}));
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		// The script runs on import; Vite resolves the .js name to the TypeScript file.
		await import('../src/write-language-manifest.js');
		return { writeFileSync, exit, stderr, stdout };
	};

	it('writes which languages both apps ship, beside the build output', async () => {
		const { writeFileSync, exit, stdout } = await run('/repo');
		expect(exit).not.toHaveBeenCalled();
		expect(writeFileSync).toHaveBeenCalledWith(
			expect.stringContaining('shipped-languages.json'),
			expect.stringContaining('"admin"'),
		);
		expect(stdout).toHaveBeenCalledWith('write-language-manifest: admin en, bn; shop en\n');
	});

	it('stops with an error when there is no repository above the build', async () => {
		const { exit, stderr } = await run(null);
		expect(stderr).toHaveBeenCalledWith('write-language-manifest: no repository above the build output\n');
		expect(exit).toHaveBeenCalledWith(1);
	});
});

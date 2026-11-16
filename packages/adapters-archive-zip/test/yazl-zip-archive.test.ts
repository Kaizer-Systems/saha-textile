import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ZipFileEntry, ZipFolderEntry } from '@saha-textile/core-domain';
import { describe, expect, it } from 'vitest';

import { YazlZipArchive } from '../src/index.js';

const text = (value: string) => new TextEncoder().encode(value);

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for await (const chunk of chunks) parts.push(chunk);
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.byteLength;
	}
	return out;
}

describe('YazlZipArchive (media step 5, A30)', () => {
	it('writes a .zip that unzip reads back: folders, an empty folder, and every file byte for byte', async () => {
		const order: string[] = [];
		const file = (path: string, body: string): ZipFileEntry => ({
			path,
			bytes: body.length,
			read: async function* () {
				order.push(`read ${path}`);
				yield text(body.slice(0, 3));
				yield text(body.slice(3));
			},
		});
		async function* entries(): AsyncIterable<ZipFileEntry | ZipFolderEntry> {
			yield { path: 'Weddings/Empty/', folder: true };
			order.push('asked 1');
			yield file('Weddings/Banarasi/front.jpg', 'red banarasi front');
			order.push('asked 2');
			yield file('Weddings/বাংলা নাম.txt', 'শাড়ি');
			order.push('asked 3');
		}
		const zip = await collect(new YazlZipArchive().write(entries()));
		// One file at a time: the next is asked for only after the one before it was read.
		expect(order).toEqual([
			'asked 1',
			'read Weddings/Banarasi/front.jpg',
			'asked 2',
			'read Weddings/বাংলা নাম.txt',
			'asked 3',
		]);
		const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
		try {
			writeFileSync(join(dir, 'out.zip'), zip);
			execFileSync('unzip', ['-q', 'out.zip', '-d', 'out'], { cwd: dir });
			expect(readFileSync(join(dir, 'out/Weddings/Banarasi/front.jpg'), 'utf8')).toBe('red banarasi front');
			expect(readFileSync(join(dir, 'out/Weddings/বাংলা নাম.txt'), 'utf8')).toBe('শাড়ি');
			expect(execFileSync('unzip', ['-Z1', 'out.zip'], { cwd: dir, encoding: 'utf8' }).split('\n')).toContain(
				'Weddings/Empty/',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a file that cannot be read ends the .zip with its error', async () => {
		async function* entries(): AsyncIterable<ZipFileEntry> {
			yield {
				path: 'broken.jpg',
				bytes: 4,
				read: async function* () {
					yield text('ab');
					throw new Error('Spaces did not answer');
				},
			};
		}
		await expect(collect(new YazlZipArchive().write(entries()))).rejects.toThrow('Spaces did not answer');
	});
});

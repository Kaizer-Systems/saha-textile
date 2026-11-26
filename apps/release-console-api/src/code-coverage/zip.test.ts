import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ZipError, unzip } from './zip.js';

interface Entry {
	name: string;
	data?: string;
	method?: number;
}

/** A zip written the way GitHub writes artifacts: local headers, then the central directory, then its end. */
function zip(entries: Entry[], { count, offset }: { count?: number; offset?: number } = {}): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let at = 0;
	for (const e of entries) {
		const name = Buffer.from(e.name);
		const plain = Buffer.from(e.data ?? '');
		const method = e.method ?? 8;
		const body = method === 8 ? deflateRawSync(plain) : plain;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(plain.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, body);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(plain.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(at, 42);
		centrals.push(central, name);
		at += 30 + name.length + body.length;
	}
	const dir = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(count ?? entries.length, 8);
	end.writeUInt16LE(count ?? entries.length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset ?? at, 16);
	return Buffer.concat([...locals, dir, end]);
}

describe('reading a coverage artifact', () => {
	it('reads stored and deflated files, skips folders and files not asked for', () => {
		const files = unzip(
			zip([
				{ name: 'admin/' },
				{ name: 'meta.json', data: '{"sha":"abc"}' },
				{ name: 'admin/coverage-final.json', data: '{}'.repeat(500), method: 0 },
				{ name: 'admin/coverage-summary.json', data: '{}' },
			]),
			(name) => !name.endsWith('summary.json'),
		);
		expect([...files.keys()]).toEqual(['meta.json', 'admin/coverage-final.json']);
		expect(files.get('meta.json')?.toString()).toBe('{"sha":"abc"}');
		expect(files.get('admin/coverage-final.json')?.length).toBe(1000);
		expect([...unzip(zip([{ name: 'a.json', data: '1' }])).keys()]).toEqual(['a.json']);
	});

	it('refuses what is not a zip, a zip64 archive, a damaged one and an unknown method', () => {
		expect(() => unzip(Buffer.from('not a zip at all, just text that is long enough'))).toThrow(
			'The coverage reports are not a zip archive.',
		);
		expect(() => unzip(zip([{ name: 'a' }], { count: 0xffff }))).toThrow('too large to read');
		expect(() => unzip(zip([{ name: 'a' }], { offset: 0xffffffff }))).toThrow('too large to read');
		expect(() => unzip(zip([{ name: 'a', data: 'x' }], { offset: 3 }))).toThrow('damaged zip archive');
		const moved = zip([{ name: 'a', data: 'x' }]);
		moved.writeUInt32LE(0, 0);
		expect(() => unzip(moved)).toThrow('damaged zip archive');
		expect(() => unzip(zip([{ name: 'a', data: 'x', method: 12 }]))).toThrow(ZipError);
		expect(() => unzip(zip([{ name: 'a', data: 'x', method: 12 }]))).toThrow('cannot read (12)');
		expect(() => unzip(zip([{ name: 'a', data: 'x' }], { count: 2 }))).toThrow('damaged zip archive');
	});
});

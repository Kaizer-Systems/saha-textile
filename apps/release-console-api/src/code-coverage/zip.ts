import { inflateRawSync } from 'node:zlib';

/** A zip the console cannot read; the message is safe to show. */
export class ZipError extends Error {}

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * The files of a zip archive (a GitHub Actions artifact) whose names `want` accepts, read with Node's own
 * zlib: stored and deflated entries, as GitHub writes them. A zip64 archive (over 4 GB or 65,535 files) is
 * refused, since a coverage run is far smaller.
 */
export function unzip(buf: Buffer, want: (name: string) => boolean = () => true): Map<string, Buffer> {
	let end = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
		if (buf.readUInt32LE(i) === END) {
			end = i;
			break;
		}
	if (end < 0) throw new ZipError('The coverage reports are not a zip archive.');
	const count = buf.readUInt16LE(end + 10);
	let at = buf.readUInt32LE(end + 16);
	if (count === 0xffff || at === 0xffffffff) throw new ZipError('The coverage reports are too large to read.');
	const out = new Map<string, Buffer>();
	for (let n = 0; n < count; n++) {
		if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL)
			throw new ZipError('The coverage reports are a damaged zip archive.');
		const method = buf.readUInt16LE(at + 10);
		const size = buf.readUInt32LE(at + 20);
		const nameLength = buf.readUInt16LE(at + 28);
		const skip = nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
		const local = buf.readUInt32LE(at + 42);
		const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
		at += 46 + skip;
		if (name.endsWith('/') || !want(name)) continue;
		if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL)
			throw new ZipError('The coverage reports are a damaged zip archive.');
		const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const raw = buf.subarray(start, start + size);
		if (method === 0) out.set(name, Buffer.from(raw));
		else if (method === 8) out.set(name, inflateRawSync(raw));
		else throw new ZipError(`The coverage reports use a zip method the console cannot read (${method}).`);
	}
	return out;
}

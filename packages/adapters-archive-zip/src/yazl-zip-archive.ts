import { Readable } from 'node:stream';

import type { ZipArchivePort, ZipFileEntry, ZipFolderEntry } from '@saha-textile/core-domain';
import { ZipFile } from 'yazl';

/** Past this an entry needs ZIP64 (the classic format counts sizes in 32 bits). */
const ZIP64_FROM_BYTES = 0xffff_fffe;

/**
 * `ZipArchivePort` with yazl (media step 5; the owner approved a zip library on 16 Nov). Entries are stored as they
 * are, without compressing again: photos, videos and archives are compressed already. One file is added at a time,
 * and only after the one before it has been written, so the caller's progress counts are real and only one file is
 * read at once. ZIP64 is used where a file or the whole .zip passes 4 GB.
 */
export class YazlZipArchive implements ZipArchivePort {
	async *write(entries: AsyncIterable<ZipFileEntry | ZipFolderEntry>): AsyncIterable<Uint8Array> {
		const zip = new ZipFile();
		const output = zip.outputStream;
		const feeding = (async () => {
			for await (const entry of entries) {
				if ('folder' in entry) {
					zip.addEmptyDirectory(entry.path);
					continue;
				}
				await new Promise<void>((resolve, reject) => {
					zip.addReadStreamLazy(
						entry.path,
						{ compress: false, ...(entry.bytes >= ZIP64_FROM_BYTES ? { forceZip64Format: true } : {}) },
						(callback) => {
							const stream = Readable.from(entry.read());
							stream.once('end', () => resolve());
							stream.once('error', reject);
							callback(null, stream);
						},
					);
				});
			}
			zip.end();
		})();
		// A file that cannot be read ends the .zip with that error instead of leaving it waiting.
		feeding.catch((error: unknown) => output.destroy(error instanceof Error ? error : new Error(String(error))));
		for await (const chunk of output as AsyncIterable<Buffer>) {
			yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		}
		await feeding;
	}
}

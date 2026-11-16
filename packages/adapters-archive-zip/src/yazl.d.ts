/** yazl ships no types; this names the part of it the archive writer uses. */
declare module 'yazl' {
	import type { Readable } from 'node:stream';

	interface EntryOptions {
		mtime?: Date;
		mode?: number;
		compress?: boolean;
		forceZip64Format?: boolean;
		size?: number;
	}

	export class ZipFile {
		readonly outputStream: Readable;
		addReadStreamLazy(
			metadataPath: string,
			options: EntryOptions,
			getReadStream: (callback: (error: Error | null, stream: Readable) => void) => void,
		): void;
		addEmptyDirectory(metadataPath: string, options?: { mtime?: Date; mode?: number }): void;
		end(options?: { forceZip64Format?: boolean }): void;
	}
}

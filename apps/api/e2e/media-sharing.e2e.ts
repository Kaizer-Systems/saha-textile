/**
 * Live end-to-end check of Media page sharing and plain files against REAL infrastructure: the
 * dev Spaces bucket, local Mongo and Redis, and a running worker (for the queued deletes).
 *
 *   pnpm e2e:media-sharing
 *
 * presign a plain file → browser-style PUT → finalize → make a link → open it → download the
 * same bytes from Spaces under the file's own name → stop it → make the file public and
 * private → send it to Trash (links stop) → delete it for good. Writes only under a fresh
 * `med_…` prefix and removes it, records included.
 */
import 'dotenv/config';

import {
	MediaShareLinkModel,
	MongoMediaAssetRepository,
	MongoMediaFavouriteRepository,
	MongoMediaFolderRepository,
	MongoMediaProfileRepository,
	MongoShareLinkRepository,
	connectMongo,
	disconnectMongo,
} from '@saha-textile/adapters-db-mongo';
import { BullMqMediaJobQueue } from '@saha-textile/adapters-queue-bullmq';
import { SpacesStorageAdapter } from '@saha-textile/adapters-storage-spaces';

import { loadConfig } from '../src/config/app-config';
import { Argon2JwtAuth } from '../src/infra/argon2-jwt.auth';
import { MediaLibraryService } from '../src/media/media-library.service';
import { MediaSharingService } from '../src/media/media-sharing.service';

const config = loadConfig();
const { key, secret, bucket, region, endpoint, cdnUrl } = config.spaces;
if (!key || !secret || !bucket) throw new Error('Spaces credentials are required for the sharing e2e');

const assets = new MongoMediaAssetRepository();
const links = new MongoShareLinkRepository();
const storage = new SpacesStorageAdapter({ key, secret, bucket, region, endpoint, cdnUrl });
const queue = new BullMqMediaJobQueue(config.redis);
// Activity lines are not written for a test run, as in the other media e2e scripts.
const audit = { append: async <T>(entry: T) => entry } as never;
// The storage check is covered by its own tests; here every upload is let through.
const storageCheck = { admit: async () => undefined, release: async () => undefined };
const library = new MediaLibraryService(
	new MongoMediaFolderRepository(),
	assets,
	assets,
	new MongoMediaFavouriteRepository(),
	links,
	storage,
	audit,
	queue,
	storageCheck as never,
	new MongoMediaProfileRepository(),
	{ findById: async () => null } as never,
);
// Every open is allowed here; the limits are covered by their own tests.
const limits = {
	consumeRateLimit: async () => ({ allowed: true }),
	checkRateLimit: async () => ({ allowed: true }),
	recordRateLimitFailure: async () => undefined,
};
// Link makers are named from the admin users; this script's actor is not one.
const admins = { findById: async () => null };
const sharing = new MediaSharingService(
	links,
	assets,
	storage,
	new Argon2JwtAuth(config),
	audit,
	limits as never,
	admins,
);
const actor = 'adm_e2e_sharing';
const ip = '127.0.0.1';

const check = (ok: boolean, label: string) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
	if (!ok) process.exitCode = 1;
};
/** The bucket's own address for a key, past the CDN cache. */
const origin = (objectKey: string) => `https://${bucket}.${region}.digitaloceanspaces.com/${objectKey}`;

async function main(): Promise<void> {
	await connectMongo();
	let assetId: string | null = null;
	try {
		const body = Buffer.from(`Saha Textile sharing e2e ${new Date().toISOString()}\n`.repeat(200));
		const presigned = await library.presignFile(actor, {
			fileName: 'শাড়ির তালিকা e2e.pdf',
			contentType: 'application/pdf',
			byteSize: body.byteLength,
			folderId: null,
		});
		assetId = presigned.assetId;
		const put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body });
		check(put.ok, `plain file: direct PUT to Spaces (HTTP ${put.status})`);
		await library.finalizeFile(actor, assetId);
		const stored = await assets.findById(assetId);
		check(stored?.processing.state === 'ready' && stored.visibility === 'private', 'plain file: ready and private');
		const key = stored?.originalStorageKey as string;
		const unsigned = await fetch(origin(key));
		check(unsigned.status === 403, `plain file: not readable without a link (HTTP ${unsigned.status})`);

		const made = await sharing.create(actor, assetId, { expiry: '1h', who: 'anyone', password: 'e2e-pass-1' });
		const code = made.code as string;
		check(/^[A-Za-z0-9]{22}$/.test(code), 'link: a 22-character code, shown once');
		const locked = await sharing.open(code, { signedInAdmin: false, ip });
		check(locked.state === 'password', 'link: asks for its password');
		const wrong = await sharing.open(code, { password: 'nope', signedInAdmin: false, ip });
		check(wrong.state === 'password' && wrong.wrong, 'link: a wrong password is refused');
		const opened = await sharing.open(code, { password: 'e2e-pass-1', signedInAdmin: false, ip });
		if (opened.state === 'open') {
			const download = await fetch(opened.url);
			const bytes = Buffer.from(await download.arrayBuffer());
			check(
				download.ok && bytes.equals(body),
				`link: Spaces hands over the same bytes (HTTP ${download.status})`,
			);
			const disposition = download.headers.get('content-disposition') ?? '';
			check(
				disposition.includes(`filename*=UTF-8''${encodeURIComponent('শাড়ির তালিকা e2e.pdf')}`),
				`link: saved under the file's own name (${disposition})`,
			);
			check(
				new URL(opened.url).searchParams.get('X-Amz-Expires') === '300',
				'link: the hand-over lasts 5 minutes',
			);
		} else check(false, `link: opens with the right password (got ${opened.state})`);
		check((await links.findById(made.id))?.opens === 1, 'link: the open is counted');

		await sharing.update(actor, made.id, { stop: true });
		check(
			(await sharing.open(code, { password: 'e2e-pass-1', signedInAdmin: false, ip })).state === 'expired',
			'link: stopped links read as expired',
		);

		const admins = await sharing.create(actor, assetId, { expiry: 'never', who: 'admins' });
		check(
			(await sharing.open(admins.code as string, { signedInAdmin: false, ip })).state === 'admins_only',
			'admins-only link: refused without an admin session',
		);
		check(
			(await sharing.open(admins.code as string, { signedInAdmin: true, ip })).state === 'open',
			'admins-only link: opens for a signed-in admin',
		);

		await library.setFileVisibility(actor, assetId, 'public');
		const publicRead = await fetch(origin(key));
		check(publicRead.ok, `public: the permanent address works (HTTP ${publicRead.status})`);
		const listed = await sharing.list(assetId);
		check(listed.publicUrl === storage.getUrl(key), 'public: the share popup shows the permanent address');
		await library.setFileVisibility(actor, assetId, 'private');
		const privateAgain = await fetch(origin(key));
		check(privateAgain.status === 403, `private again: the address stops at once (HTTP ${privateAgain.status})`);

		await library.trash(actor, { fileIds: [assetId], folderIds: [] });
		check(
			(await sharing.open(admins.code as string, { signedInAdmin: true, ip })).state === 'expired',
			'Trash: every link of the file stops',
		);
		await library.restore(actor, { fileIds: [assetId], folderIds: [] });
		check(
			(await sharing.open(admins.code as string, { signedInAdmin: true, ip })).state === 'expired',
			'restored: its links stay stopped',
		);
		await library.trash(actor, { fileIds: [assetId], folderIds: [] });
		await library.deleteForever(actor, { fileIds: [assetId], folderIds: [] });
		check((await assets.findById(assetId)) === null, 'delete forever: the record is gone');
		let gone = false;
		for (let attempt = 0; attempt < 30 && !gone; attempt += 1) {
			await new Promise((settle) => setTimeout(settle, 1000));
			const signedRead = await fetch(await storage.createSignedDownloadUrl({ key, expiresInSeconds: 60 }));
			gone = signedRead.status === 404;
		}
		check(gone, 'delete forever: the worker removed the object from Spaces');
	} finally {
		if (assetId) {
			const left = await assets.findById(assetId);
			if (left?.originalStorageKey) await storage.delete(left.originalStorageKey);
			if (left) await assets.hardDelete(assetId);
			await MediaShareLinkModel.deleteMany({ assetId });
		}
		console.log('cleanup: the test file, its records and its links are removed');
		await queue.close();
		await disconnectMongo();
	}
}

void main();

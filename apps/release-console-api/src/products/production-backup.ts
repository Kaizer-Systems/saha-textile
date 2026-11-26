/**
 * Whether a production backup exists to rehearse a release on (Release Path brief, Ship › Rehearsal).
 * The nightly database backup to Spaces is not built yet (decisions log: "Backups go to Spaces only"),
 * so this answers "not ready" for now. Once the nightly job exists, it reads the newest object in the
 * production backup bucket and answers ready with that backup's time.
 */
import type { ProductCtx } from './kit.js';

export async function productionBackup(_ctx: ProductCtx): Promise<{ ready: boolean; detail: string }> {
	return { ready: false, detail: 'the nightly database backup starts with the production server' };
}

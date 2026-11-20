import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GeoDataUnavailableError, loadGeoManifest } from '@saha-textile/adapters-geo';
import { describe, expect, it, vi } from 'vitest';

import { buildGeoData } from '../src/geo/geo.module';

const config = (dataDir?: string) => ({ geo: { dataDir } }) as never;

describe('geo data wiring (owner, 2026-11-20: kept in Spaces)', () => {
	it('reads only the file asked for from this environment’s bucket, by its content hash', async () => {
		const manifest = loadGeoManifest();
		const download = vi.fn(async () => new TextEncoder().encode('not the real file'));
		const geo = buildGeoData(config(), { download } as never);
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		expect(download).toHaveBeenCalledTimes(1);
		expect(download).toHaveBeenCalledWith(`geo/${manifest.files['countries.json']?.sha256}.json`);
	});

	it('GEO_DATA_DIR reads a local folder instead, never the bucket', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'geo-dir-'));
		writeFileSync(join(dir, 'countries.json'), '[]');
		const download = vi.fn();
		const geo = buildGeoData(config(dir), { download } as never);
		// The folder's file isn't the manifest's, so it is refused: the hash check holds for folders too.
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		expect(download).not.toHaveBeenCalled();
	});
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GEO_MANIFEST_KEY, GeoDataUnavailableError } from '@saha-textile/adapters-geo';
import { describe, expect, it, vi } from 'vitest';

import { buildGeoData } from '../src/geo/geo.module';

const config = (dataDir?: string) => ({ geo: { dataDir } }) as never;
const manifest = {
	schema: 1,
	version: 'v1',
	counts: { countries: 0, withSubdivisions: 0, pins: 0 },
	sources: {},
	files: { 'countries.json': { sha256: 'a'.repeat(64), bytes: 2 } },
};

describe('geo data wiring (owner, 2026-11-20: kept in Spaces, published there directly)', () => {
	it('reads the bucket’s own index first, then only the file asked for, by its content hash', async () => {
		const download = vi.fn(async (key: string) =>
			new TextEncoder().encode(key === GEO_MANIFEST_KEY ? JSON.stringify(manifest) : 'not the real file'),
		);
		const geo = buildGeoData(config(), { download } as never);
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		expect(download.mock.calls.map(([key]) => key)).toEqual([GEO_MANIFEST_KEY, `geo/${'a'.repeat(64)}.json`]);
	});

	it('GEO_DATA_DIR reads a local folder instead, never the bucket', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'geo-dir-'));
		writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
		writeFileSync(join(dir, 'countries.json'), '[]');
		const download = vi.fn();
		const geo = buildGeoData(config(dir), { download } as never);
		// The folder's file isn't the one the index names, so it is refused: the hash check holds for folders too.
		await expect(geo.countries()).rejects.toBeInstanceOf(GeoDataUnavailableError);
		expect(download).not.toHaveBeenCalled();
	});
});

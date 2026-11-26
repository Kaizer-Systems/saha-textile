import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import {
	ManifestGeoDataAdapter,
	folderGeoManifest,
	folderGeoReader,
	storageGeoManifest,
	storageGeoReader,
} from '@saha-textile/adapters-geo';
import type { GeoDataPort, StoragePort } from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { GEO_DATA_PORT, STORAGE_PORT } from '../infra/tokens';
import { GeoController } from './geo.controller';

/**
 * Country, State, phone and PIN data (`DEC-ADDRESS`; owner, 2026-11-20: kept in Spaces, published there
 * directly). Each answer reads only the small file it needs from this environment's bucket
 * (`geo/<sha256>.json`), named by the bucket's own index (`geo/manifest.json`, re-read every few hours),
 * and keeps it in memory. GEO_DATA_DIR reads a local folder instead.
 */
export function buildGeoData(config: AppConfig, storage: StoragePort): ManifestGeoDataAdapter {
	const dir = config.geo.dataDir;
	const download = (key: string) => storage.download(key);
	return new ManifestGeoDataAdapter({
		read: dir ? folderGeoReader(dir) : storageGeoReader(download),
		loadManifest: dir ? folderGeoManifest(dir) : storageGeoManifest(download),
	});
}

@Module({
	controllers: [GeoController],
	providers: [{ provide: GEO_DATA_PORT, useFactory: buildGeoData, inject: [APP_CONFIG, STORAGE_PORT] }],
	exports: [GEO_DATA_PORT],
})
export class GeoModule implements OnApplicationBootstrap {
	private readonly logger = new Logger('GeoData');

	constructor(@Inject(GEO_DATA_PORT) private readonly geo: GeoDataPort) {}

	/** A missing upload shows in the log at start-up, not first at a customer's address form. */
	onApplicationBootstrap(): void {
		if (process.env.SAHA_TEXTILE_DOCUMENTATION_BUILD === '1' || process.env.VITEST) return;
		void this.geo.countries().catch((error: unknown) => {
			this.logger.warn(
				`Country data could not be read (${error instanceof Error ? error.message : 'unknown'}). ` +
					'Upload it to this environment with: node --env-file=<env file> scripts/geo/upload.mjs',
			);
		});
	}
}

import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import {
	ManifestGeoDataAdapter,
	folderGeoReader,
	loadGeoManifest,
	storageGeoReader,
} from '@saha-textile/adapters-geo';
import type { GeoDataPort, StoragePort } from '@saha-textile/core-domain';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { GEO_DATA_PORT, STORAGE_PORT } from '../infra/tokens';
import { GeoController } from './geo.controller';

/**
 * Country, State, phone and PIN data (`DEC-ADDRESS`; owner, 2026-11-20: kept in Spaces). Each answer
 * reads only the small file it needs from this environment's bucket (`geo/<sha256>.json`, named by the
 * manifest shipped with @saha-textile/adapters-geo) and keeps it in memory. GEO_DATA_DIR reads a local
 * folder instead.
 */
export function buildGeoData(config: AppConfig, storage: StoragePort): ManifestGeoDataAdapter {
	const manifest = loadGeoManifest();
	const read = config.geo.dataDir
		? folderGeoReader(config.geo.dataDir)
		: storageGeoReader((key) => storage.download(key));
	return new ManifestGeoDataAdapter({ manifest, read });
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

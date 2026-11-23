import { Module } from '@nestjs/common';
import { MongoEDocKeyStore, MongoEDocRepository, UnavailableEDocKeyStore } from '@saha-textile/adapters-db-mongo';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { EDOC_KEY_STORE, EDOC_REPOSITORY } from '../infra/tokens';
import { EDocGatewayFactory } from './edoc-gateways';
import { EDocsOrderBridge } from './edocs-order-bridge';
import { EDocsController } from './edocs.controller';
import { EDocsService } from './edocs.service';

/**
 * Where the automatic paths' keys are kept (AE6): sealed under EDOC_KEYS_KEY (and the previous key while it rotates);
 * without that server key only the by-hand path can be used.
 */
export function edocKeyStoreFor(config: Pick<AppConfig, 'edocs'>): MongoEDocKeyStore | UnavailableEDocKeyStore {
	const key = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
	const { keysKey, keysKeyPrevious } = config.edocs;
	if (!keysKey) return new UnavailableEDocKeyStore();
	return new MongoEDocKeyStore(key(keysKey), keysKeyPrevious ? key(keysKeyPrevious) : undefined);
}

/** E-invoice and e-way bill: five paths, one set of buttons (accounts brief addendum 2). */
@Module({
	controllers: [EDocsController],
	providers: [
		EDocsService,
		EDocsOrderBridge,
		EDocGatewayFactory,
		{ provide: EDOC_REPOSITORY, useClass: MongoEDocRepository },
		{ provide: EDOC_KEY_STORE, inject: [APP_CONFIG], useFactory: edocKeyStoreFor },
	],
	exports: [EDocsService, EDocsOrderBridge, EDOC_REPOSITORY],
})
export class EDocsModule {}

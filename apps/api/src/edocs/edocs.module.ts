import { Module } from '@nestjs/common';
import { MongoEDocKeyStore, MongoEDocRepository, UnavailableEDocKeyStore } from '@saha-textile/adapters-db-mongo';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { EDOC_KEY_STORE, EDOC_REPOSITORY } from '../infra/tokens';
import { EDocGatewayFactory } from './edoc-gateways';
import { EDocsOrderBridge } from './edocs-order-bridge';
import { EDocsController } from './edocs.controller';
import { EDocsService } from './edocs.service';

/** E-invoice and e-way bill: five paths, one set of buttons (accounts brief addendum 2). */
@Module({
	controllers: [EDocsController],
	providers: [
		EDocsService,
		EDocsOrderBridge,
		EDocGatewayFactory,
		{ provide: EDOC_REPOSITORY, useClass: MongoEDocRepository },
		{
			provide: EDOC_KEY_STORE,
			inject: [APP_CONFIG],
			useFactory: (config: AppConfig) =>
				config.edocs.keysKey
					? new MongoEDocKeyStore(
							new Uint8Array(Buffer.from(config.edocs.keysKey, 'base64')),
							config.edocs.keysKeyPrevious
								? new Uint8Array(Buffer.from(config.edocs.keysKeyPrevious, 'base64'))
								: undefined,
						)
					: new UnavailableEDocKeyStore(),
		},
	],
	exports: [EDocsService, EDocsOrderBridge, EDOC_REPOSITORY],
})
export class EDocsModule {}

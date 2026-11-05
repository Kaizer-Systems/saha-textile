import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

import { appConfig } from './app.config';
import { ServerApiTimeoutInterceptor } from './core/interceptors/server-api-timeout.interceptor';
import { provideQueryTransfer } from './core/query/query-transfer.server';

const serverConfig: ApplicationConfig = {
	providers: [
		provideServerRendering(),
		provideQueryTransfer(),
		{ provide: HTTP_INTERCEPTORS, useClass: ServerApiTimeoutInterceptor, multi: true },
	],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

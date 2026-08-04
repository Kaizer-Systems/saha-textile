import { type DynamicModule, Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig, loadConfig } from './app-config';

/**
 * Supplies the validated runtime configuration to every module.
 *
 * `forRoot` takes an explicit config so a caller can compose the application with values
 * that are NOT in the ambient environment. It used to be a plain module whose factory
 * called `loadConfig()` itself, which made `createApp(config)` a half-truth: the argument
 * shaped the HTTP adapter while every service quietly read `process.env`. A harness that
 * passed a one-second `JWT_ACCESS_TTL` and then waited for the access cookie to expire
 * found that out the slow way.
 *
 * The default preserves the ambient behaviour for process startup, where reading the
 * environment is exactly right.
 */
@Global()
@Module({})
export class ConfigModule {
	static forRoot(config: AppConfig = loadConfig()): DynamicModule {
		return {
			module: ConfigModule,
			providers: [{ provide: APP_CONFIG, useValue: config }],
			exports: [APP_CONFIG],
		};
	}
}

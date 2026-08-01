import { Global, Module } from '@nestjs/common';

import { AdminAuthController } from './admin-auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { StorefrontAuthController } from './storefront-auth.controller';

/**
 * Cookie-session authentication (Chunk D). The transitional bearer-JWT controller and its
 * guard are gone: the browser happy path is cookie-only, and bearer support is reserved
 * for approved non-browser clients.
 */
@Global()
@Module({
	controllers: [StorefrontAuthController, AdminAuthController],
	providers: [AuthService, SessionService],
	exports: [AuthService, SessionService],
})
export class AuthModule {}

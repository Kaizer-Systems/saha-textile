import { Global, Module } from '@nestjs/common';

import { CartModule } from '../cart/cart.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminInviteService } from './admin-invite.service';
import { AdminSecurityService } from './admin-security.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { OAuthService } from './oauth.service';
import { SignupService } from './signup.service';
import { StorefrontAuthController } from './storefront-auth.controller';

/**
 * Cookie-session authentication (Chunk D). The transitional bearer-JWT controller and its
 * guard are gone: the browser happy path is cookie-only, and bearer support is reserved
 * for approved non-browser clients.
 */
@Global()
@Module({
	imports: [CartModule],
	controllers: [StorefrontAuthController, AdminAuthController],
	providers: [AuthService, SessionService, SignupService, OAuthService, AdminInviteService, AdminSecurityService],
	exports: [AuthService, SessionService, SignupService, OAuthService, AdminInviteService, AdminSecurityService],
})
export class AuthModule {}

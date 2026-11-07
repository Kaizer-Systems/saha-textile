import { Module } from '@nestjs/common';

import { ContactChangeService } from './contact-change.service';
import { StorefrontAddressesController } from './storefront-addresses.controller';
import { StorefrontContactController } from './storefront-contact.controller';
import { StorefrontProfileController } from './storefront-profile.controller';

/**
 * Customer self-service.
 *
 * Kept apart from `AdminModule` for the same reason the routes are: an operator surface acts on
 * somebody else's account and is authorised per permission, while everything here is scoped to
 * the caller's own session and carries no customer id at all. One folder per audience is what
 * makes a route's authorisation model obvious from where it lives.
 *
 * `AuthService` and `SessionService` arrive through `AuthModule`, which is `@Global`. They are
 * taken rather than re-provided on purpose: the contact-change routes need the SAME step-up rule
 * and the same session revocation the auth controller uses, and a second instance of either
 * would be a second copy of the rules — the divergence this whole surface is shaped to avoid.
 */
@Module({
	controllers: [StorefrontAddressesController, StorefrontProfileController, StorefrontContactController],
	providers: [ContactChangeService],
})
export class StorefrontModule {}

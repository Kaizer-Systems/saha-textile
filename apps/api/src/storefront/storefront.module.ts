import { Module } from '@nestjs/common';

import { StorefrontAddressesController } from './storefront-addresses.controller';
import { StorefrontProfileController } from './storefront-profile.controller';

/**
 * Customer self-service.
 *
 * Kept apart from `AdminModule` for the same reason the routes are: an operator surface acts on
 * somebody else's account and is authorised per permission, while everything here is scoped to
 * the caller's own session and carries no customer id at all. One folder per audience is what
 * makes a route's authorisation model obvious from where it lives.
 */
@Module({
	controllers: [StorefrontAddressesController, StorefrontProfileController],
})
export class StorefrontModule {}

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { AdminCustomerAddressBookController, StorefrontAddressBookController } from './address-book.controller';
import { AddressBookService } from './address-book.service';

/** Saved addresses with the country rules (`DEC-ADDRESS`), and the check both checkouts use. */
@Module({
	imports: [AuthModule, GeoModule],
	controllers: [StorefrontAddressBookController, AdminCustomerAddressBookController],
	providers: [AddressBookService],
	exports: [AddressBookService],
})
export class AddressesModule {}

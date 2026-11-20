import { randomUUID } from 'node:crypto';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Business, BusinessAddressWrite, SavedAddressRow } from '@saha-textile/contracts';
import type { BusinessRepository } from '@saha-textile/core-domain';

import { AddressBookService } from '../addresses/address-book.service';
import { BUSINESS_REPOSITORY } from '../infra/tokens';
import { refuseStale } from '../orders-setup/orders-audit';

/**
 * A business's delivery addresses (brief bz02 "Add a delivery address"; DEC-ADDRESS): checked
 * against the same country rules as a customer's, kept on the business record, and offered at the
 * admin checkout when an order is for that business. One address is the default.
 */
@Injectable()
export class BusinessAddressesService {
	constructor(
		@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
		private readonly addressBook: AddressBookService,
	) {}

	async add(businessId: string, input: BusinessAddressWrite): Promise<Business> {
		const business = await this.get(businessId);
		const row = await this.row(`adr_${randomUUID()}`, input);
		return this.save(business, withDefault([...business.addresses, row], row.id, row.isDefault));
	}

	async replace(businessId: string, addressId: string, input: BusinessAddressWrite): Promise<Business> {
		const business = await this.get(businessId);
		if (!business.addresses.some((row) => row.id === addressId)) throw new NotFoundException('Address not found');
		const row = await this.row(addressId, input);
		return this.save(
			business,
			withDefault(
				business.addresses.map((current) => (current.id === addressId ? row : current)),
				addressId,
				row.isDefault,
			),
		);
	}

	async remove(businessId: string, addressId: string): Promise<Business> {
		const business = await this.get(businessId);
		const left = business.addresses.filter((row) => row.id !== addressId);
		if (left.length === business.addresses.length) throw new NotFoundException('Address not found');
		return this.save(business, withDefault(left, left.find((row) => row.isDefault)?.id ?? left[0]?.id ?? '', true));
	}

	private async get(id: string): Promise<Business> {
		const business = await this.businesses.findById(id);
		if (!business) throw new NotFoundException('Business not found');
		return business;
	}

	private async row(id: string, input: BusinessAddressWrite): Promise<SavedAddressRow> {
		const checked = await this.addressBook.check(input);
		return { ...checked, id, label: input.label, isDefault: input.isDefault } as SavedAddressRow;
	}

	private save(business: Business, addresses: SavedAddressRow[]): Promise<Business> {
		return refuseStale(
			() =>
				this.businesses.save(
					{ ...business, addresses, updatedAt: new Date().toISOString() },
					business.revision,
				),
			'Someone else saved this business first',
		);
	}
}

/** Exactly one default: the one just marked, else the existing one, else the first. */
export function withDefault(rows: SavedAddressRow[], markedId: string, marked: boolean): SavedAddressRow[] {
	const defaultId = marked ? markedId : (rows.find((row) => row.isDefault)?.id ?? rows[0]?.id);
	return rows.map((row) => ({ ...row, isDefault: row.id === defaultId }));
}

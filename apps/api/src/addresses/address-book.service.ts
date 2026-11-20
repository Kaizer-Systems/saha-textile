import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
	formatPhoneNumber,
	type Address,
	type AddressProblem,
	type Customer,
	type PostalAddressInput,
	type SavedAddressWrite,
} from '@saha-textile/contracts';
import { checkAddress, type CustomerRepository, type GeoDataPort } from '@saha-textile/core-domain';

import { CUSTOMER_REPOSITORY, GEO_DATA_PORT } from '../infra/tokens';

/** An address after the checks, as saved addresses and orders keep it. */
export type CheckedPostalAddress = Omit<Address, 'id' | 'label' | 'isDefault'>;

/** Each problem as its own issue, on the field it is about, so the form marks the right box. */
export function addressRefusal(problems: ReadonlyArray<{ field: string; problem: AddressProblem }>) {
	return new BadRequestException({
		message: 'Validation failed',
		issues: problems.map((row) => ({ path: row.field, message: row.problem, code: row.problem })),
	});
}

/**
 * Saved addresses and every address typed at either checkout (`DEC-ADDRESS`, owner 2026-11-20):
 * the country limits the State list and sets the phone code (changeable for the phone only); a
 * mobile is required (10 digits in India, the country's own lengths abroad); in India the PIN code
 * must exist and match the State once the PIN directory is loaded. The State's name and GST code
 * come from the country data, never from the form.
 */
@Injectable()
export class AddressBookService {
	constructor(
		@Inject(GEO_DATA_PORT) private readonly geo: GeoDataPort,
		@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
	) {}

	async check(input: PostalAddressInput): Promise<CheckedPostalAddress> {
		const country = await this.geo.country(input.countryCode);
		const pin =
			input.countryCode === 'IN' && /^\d{6}$/.test(input.postalCode)
				? await this.geo.pin(input.postalCode)
				: null;
		const result = checkAddress(input, {
			country,
			subdivisions: country?.subdivisions ?? [],
			pin,
			mobileLengthsForCode: await this.geo.mobileLengths(input.mobile.countryCallingCode),
		});
		if (result.problems.length) throw addressRefusal(result.problems);
		return {
			fullName: input.fullName,
			line1: input.line1,
			line2: input.line2 ?? '',
			landmark: input.landmark ?? '',
			city: input.city,
			state: result.state ?? input.state ?? '',
			...(input.subdivisionCode ? { subdivisionCode: input.subdivisionCode } : {}),
			...(result.gstStateCode ? { gstStateCode: result.gstStateCode } : {}),
			postalCode: input.postalCode,
			country: input.countryCode,
			countryCode: input.countryCode,
			mobile: input.mobile,
			altMobile: input.altMobile ?? null,
			phone: formatPhoneNumber(input.mobile),
		};
	}

	async add(customerId: string, input: SavedAddressWrite): Promise<Customer> {
		const checked = await this.check(input);
		const updated = await this.customers.addAddress(customerId, {
			...checked,
			id: `adr_${randomUUID()}`,
			label: input.label,
			isDefault: input.isDefault,
		});
		if (!updated) throw new NotFoundException('Customer not found');
		return updated;
	}

	/** Replaces every field of one saved address (an emptied field is cleared, not kept). */
	async replace(customerId: string, addressId: string, input: SavedAddressWrite): Promise<Customer> {
		const checked = await this.check(input);
		const updated = await this.customers.replaceAddress(customerId, {
			...checked,
			id: addressId,
			label: input.label,
			isDefault: input.isDefault,
		});
		if (!updated || !updated.addresses.some((row) => row.id === addressId)) {
			throw new NotFoundException('Address not found');
		}
		return updated;
	}
}

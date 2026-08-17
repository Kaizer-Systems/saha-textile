/**
 * The customer as OUR API returns it, mirroring `packages/contracts` `Customer`.
 *
 * Declared here rather than imported: neither Angular app depends on `@saha-textile/contracts`
 * — they consume the API over HTTP and hold their own view types, which is the same shape the
 * admin app follows. `check:route-contracts` is what keeps this honest against the real API.
 */
export interface ICustomerAddress {
	id: string;
	label?: string;
	fullName: string;
	line1: string;
	line2?: string;
	city: string;
	state?: string;
	postalCode: string;
	country: string;
	phone?: string;
	isDefault: boolean;
}

export interface ICustomerIdentity {
	provider: string;
	providerId?: string;
	email?: string;
}

export interface ICustomer {
	id: string;
	email: string | null;
	emailVerified: boolean;
	/** E.164, so it carries its own dial code. */
	phone: string | null;
	phoneVerified: boolean;
	displayName?: string;
	status: 'active' | 'pending' | 'disabled' | 'locked' | 'deleted';
	identities: ICustomerIdentity[];
	addresses: ICustomerAddress[];
	createdAt?: string;
	updatedAt?: string;
}

/** `GET /auth/storefront/me`. */
export interface IMeResponse {
	user: ICustomer;
}

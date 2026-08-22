import type { Address, Customer, CustomerListQuery, Paginated, CustomerStatus } from '@saha-textile/contracts';

/** A customer identifier that the database enforces as unique. */
export type UniqueCustomerIdentifier = 'email' | 'phone';

/**
 * A write lost the race for an email or phone that must be unique.
 *
 * Raised by the persistence adapter when the unique index refuses, so callers can answer with
 * their own stable refusal instead of leaking a driver error as a 500.
 *
 * ## Why a check before the write is not enough
 *
 * Every caller that cares already looks the value up first — signup resolves ownership before
 * spending its proof, and a contact change tests the new value before sending a code. Those
 * lookups are courtesies: they give a good message early and cheaply. NONE of them closes the
 * window between reading and writing, and the window is real whenever two people race for one
 * address, which is exactly when it matters.
 *
 * So the index stays the arbiter and this is how its verdict travels. A pre-check that is
 * trusted as the decision is a check that will eventually be wrong under load.
 */
export class DuplicateIdentifierError extends Error {
	constructor(readonly field: UniqueCustomerIdentifier) {
		super(`A customer already holds that ${field}`);
		this.name = 'DuplicateIdentifierError';
	}
}

/** Credential bundle kept inside the infra boundary (hash never leaves it lightly). */
export interface CustomerCredential {
	customer: Customer;
	passwordHash: string | null;
}

/** Fields an admin may patch on a customer profile (no addresses, no secrets). */
export type CustomerUpdateInput = {
	displayName?: string;
	email?: string;
	phone?: string | null;
	status?: CustomerStatus;
};

/**
 * Public customer persistence (`customers` collection).
 *
 * Credential material is reachable only through `CustomerAuthRepository` — this port
 * deals in the sanitized `Customer` shape (`DEC-ACCOUNT-SEPARATION`).
 *
 * Soft-delete is `status: 'deleted'` (`customer.destroy`); unique email/phone indexes
 * exclude deleted rows so an address can be reclaimed after offboarding.
 */
export interface CustomerRepository {
	findById(id: string): Promise<Customer | null>;
	findByEmail(email: string): Promise<Customer | null>;
	/**
	 * Resolves a customer by phone number.
	 *
	 * Phone became a first-class login credential under `DEC-SIGNUP-VERIFICATION`, so it must be
	 * resolvable the same way an email is. Soft-deleted rows are excluded by the same partial
	 * unique index that lets a released number be reclaimed.
	 */
	findByPhone(phone: string): Promise<Customer | null>;
	findCredentialByEmail(email: string): Promise<CustomerCredential | null>;
	/** Paginated CRM directory with optional status filter and S1 prefix search. */
	list(query: CustomerListQuery): Promise<Paginated<Customer>>;
	create(customer: Customer): Promise<Customer>;
	update(customerId: string, patch: CustomerUpdateInput): Promise<Customer | null>;
	setStatus(customerId: string, status: CustomerStatus): Promise<Customer | null>;
	addAddress(customerId: string, address: Address): Promise<Customer | null>;
	updateAddress(customerId: string, addressId: string, patch: Partial<Omit<Address, 'id'>>): Promise<Customer | null>;
	deleteAddress(customerId: string, addressId: string): Promise<Customer | null>;
	/**
	 * Upserts the customer row.
	 *
	 * `customer.identities` is IGNORED. Identity links belong to `AuthIdentityRepository`, which
	 * attaches and detaches them one at a time; the field survives on `Customer` as a read
	 * projection, filled in on the way out. Accepting it here as well gave two writers to one
	 * collection, and the one that lived here replaced the whole set from whatever list a caller
	 * happened to hold.
	 */
	save(customer: Customer): Promise<Customer>;
	setPasswordHash(customerId: string, passwordHash: string): Promise<void>;
}

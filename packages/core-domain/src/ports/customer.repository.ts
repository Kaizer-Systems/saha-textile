import type { Address, Customer, CustomerListQuery, Paginated, CustomerStatus } from '@saha-textile/contracts';

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
	save(customer: Customer): Promise<Customer>;
	setPasswordHash(customerId: string, passwordHash: string): Promise<void>;
}

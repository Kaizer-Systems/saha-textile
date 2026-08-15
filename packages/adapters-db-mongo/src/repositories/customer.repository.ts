import type { Address, Customer, CustomerListQuery, Paginated, UserStatus } from '@saha-textile/contracts';
import type { CustomerCredential, CustomerRepository, CustomerUpdateInput } from '@saha-textile/core-domain';

import { toCustomer } from '../mappers';
import {
	AuthIdentityModel,
	type CustomerDoc,
	CustomerModel,
	loadPasswordHash,
	loadPublicIdentities,
	replacePublicIdentities,
	upsertPasswordCredential,
} from '../models/index';

/** Escape user input before embedding it in a Mongo regex (contains search). */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Live (non-deleted) rows only — soft-deleted emails/phones may be reclaimed. */
const NOT_DELETED = { status: { $ne: 'deleted' } } as const;

async function mapCustomer(doc: CustomerDoc): Promise<Customer> {
	return toCustomer(doc, (await loadPublicIdentities('customer', doc._id)) as Customer['identities']);
}

async function mapCustomers(docs: CustomerDoc[]): Promise<Customer[]> {
	if (docs.length === 0) return [];
	const ids = docs.map((doc) => doc._id);
	const rows = await AuthIdentityModel.find({ subjectType: 'customer', subjectId: { $in: ids } })
		.lean()
		.exec();
	const bySubject = new Map<string, Customer['identities']>();
	for (const row of rows) {
		const list = bySubject.get(row.subjectId) ?? [];
		list.push({
			provider: row.provider as Customer['identities'][number]['provider'],
			providerId: row.providerSubject,
			...(row.email ? { email: row.email } : {}),
		});
		bySubject.set(row.subjectId, list);
	}
	return docs.map((doc) => toCustomer(doc, bySubject.get(doc._id) ?? []));
}

export class MongoCustomerRepository implements CustomerRepository {
	async findById(id: string): Promise<Customer | null> {
		const doc = await CustomerModel.findById(id).lean<CustomerDoc>().exec();
		return doc ? mapCustomer(doc) : null;
	}

	async findByEmail(email: string): Promise<Customer | null> {
		const doc = await CustomerModel.findOne({ email, ...NOT_DELETED })
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	async findCredentialByEmail(email: string): Promise<CustomerCredential | null> {
		const doc = await CustomerModel.findOne({ email, ...NOT_DELETED })
			.lean<CustomerDoc>()
			.exec();
		if (!doc) return null;
		return {
			customer: await mapCustomer(doc),
			passwordHash: await loadPasswordHash('customer', doc._id),
		};
	}

	async list(query: CustomerListQuery): Promise<Paginated<Customer>> {
		const page = query.page;
		const pageSize = query.pageSize;
		const filter: Record<string, unknown> = {};

		// Soft-deleted rows only when status=deleted is requested explicitly (contract).
		if (query.status) {
			filter.status = query.status;
		} else {
			Object.assign(filter, NOT_DELETED);
		}

		const q = query.q?.trim();
		if (q) {
			// Tokenize by whitespace; each token must appear as a substring in at least one field
			const tokens = q.split(/\s+/).filter((t) => t.length > 0);
			const tokenConditions = tokens.map((token) => {
				const contains = new RegExp(escapeRegex(token), 'i');
				return { $or: [{ email: contains }, { phone: contains }, { displayName: contains }] };
			});
			filter.$and = tokenConditions;
		}

		const sortField: Record<string, 1 | -1> = query.sort === 'displayName' ? { displayName: 1 } : { createdAt: -1 };

		const [total, docs] = await Promise.all([
			CustomerModel.countDocuments(filter).exec(),
			CustomerModel.find(filter)
				.sort(sortField)
				.skip((page - 1) * pageSize)
				.limit(pageSize)
				.lean<CustomerDoc[]>()
				.exec(),
		]);
		const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
		return {
			items: await mapCustomers(docs),
			meta: {
				page,
				pageSize,
				total,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1,
			},
		};
	}

	async create(customer: Customer): Promise<Customer> {
		return this.save(customer);
	}

	async update(customerId: string, patch: CustomerUpdateInput): Promise<Customer | null> {
		const $set: Record<string, unknown> = {};
		if (patch.displayName !== undefined) $set.displayName = patch.displayName;
		if (patch.email !== undefined) $set.email = patch.email;
		if (patch.phone !== undefined) $set.phone = patch.phone;
		if (patch.status !== undefined) $set.status = patch.status;
		if (Object.keys($set).length === 0) {
			return this.findById(customerId);
		}
		const doc = await CustomerModel.findByIdAndUpdate(customerId, { $set }, { returnDocument: 'after' })
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	async setStatus(customerId: string, status: UserStatus): Promise<Customer | null> {
		return this.update(customerId, { status });
	}

	async addAddress(customerId: string, address: Address): Promise<Customer | null> {
		const customer = await this.findById(customerId);
		if (!customer) return null;
		const addresses = address.isDefault
			? customer.addresses.map((row) => ({ ...row, isDefault: false }))
			: [...customer.addresses];
		addresses.push(address);

		const doc = await CustomerModel.findByIdAndUpdate(
			customerId,
			{ $set: { addresses } },
			{ returnDocument: 'after' },
		)
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	async updateAddress(
		customerId: string,
		addressId: string,
		patch: Partial<Omit<Address, 'id'>>,
	): Promise<Customer | null> {
		const customer = await this.findById(customerId);
		if (!customer) return null;
		const index = customer.addresses.findIndex((row) => row.id === addressId);
		if (index < 0) return null;

		const current = customer.addresses[index] as Address;
		const next: Address = {
			...current,
			...patch,
			id: addressId,
			fullName: patch.fullName ?? current.fullName,
			line1: patch.line1 ?? current.line1,
			city: patch.city ?? current.city,
			postalCode: patch.postalCode ?? current.postalCode,
			country: patch.country ?? current.country,
			isDefault: patch.isDefault ?? current.isDefault,
		};
		let addresses = [...customer.addresses];
		addresses[index] = next;
		if (next.isDefault) {
			addresses = addresses.map((row, i) => (i === index ? next : { ...row, isDefault: false }));
		}

		const doc = await CustomerModel.findByIdAndUpdate(
			customerId,
			{ $set: { addresses } },
			{ returnDocument: 'after' },
		)
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	async deleteAddress(customerId: string, addressId: string): Promise<Customer | null> {
		const doc = await CustomerModel.findByIdAndUpdate(
			customerId,
			{ $pull: { addresses: { id: addressId } } },
			{ returnDocument: 'after' },
		)
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	async save(customer: Customer): Promise<Customer> {
		const { id, identities, ...rest } = customer;
		const doc = await CustomerModel.findByIdAndUpdate(
			id,
			{ $set: rest },
			{ upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
		)
			.lean<CustomerDoc>()
			.exec();
		await replacePublicIdentities('customer', id, identities ?? []);
		return mapCustomer(doc as CustomerDoc);
	}

	async setPasswordHash(customerId: string, passwordHash: string): Promise<void> {
		await upsertPasswordCredential('customer', customerId, passwordHash);
	}
}

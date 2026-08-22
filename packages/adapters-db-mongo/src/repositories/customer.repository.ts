import type { Address, Customer, CustomerListQuery, Paginated, CustomerStatus } from '@saha-textile/contracts';
import type { CustomerCredential, CustomerRepository, CustomerUpdateInput } from '@saha-textile/core-domain';

import { asDuplicateIdentifier } from '../duplicate-key';
import { sessionFrom } from '../transaction-manager';
import { toCustomer } from '../mappers';
import {
	AuthIdentityModel,
	type CustomerDoc,
	CustomerModel,
	loadPasswordHash,
	loadPublicIdentities,
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

/**
 * The address fields a patch may write, taken from the `Address` contract minus its id.
 *
 * A fixed list, because these names become query PATHS. Deriving them from whatever keys the
 * caller sent would let a request choose where it writes.
 */
const PATCHABLE_ADDRESS_FIELDS = [
	'label',
	'fullName',
	'line1',
	'line2',
	'city',
	'state',
	'postalCode',
	'country',
	'phone',
	'isDefault',
] as const satisfies ReadonlyArray<keyof Omit<Address, 'id'>>;

export class MongoCustomerRepository implements CustomerRepository {
	async findById(id: string): Promise<Customer | null> {
		const doc = await CustomerModel.findById(id).lean<CustomerDoc>().exec();
		return doc ? mapCustomer(doc) : null;
	}

	async findByPhone(phone: string): Promise<Customer | null> {
		// Excludes tombstones so a reclaimed number resolves to whoever holds it NOW, matching
		// the partial unique index that released it.
		const doc = await CustomerModel.findOne({ phone, status: { $ne: 'deleted' } })
			.lean<CustomerDoc>()
			.exec();
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

	async setStatus(customerId: string, status: CustomerStatus): Promise<Customer | null> {
		return this.update(customerId, { status });
	}

	/**
	 * Appends an address in ONE atomic statement.
	 *
	 * It used to read the whole array into memory, rebuild it, and `$set` the result back. That is
	 * a lost update waiting to happen: two writers each read `[Home]`, each write their own
	 * two-element array, and whoever lands second erases the other's address — while BOTH callers
	 * are handed a success response containing the address that is about to disappear. The window
	 * is milliseconds, but the two writers are real and independent: a customer editing at
	 * checkout and an operator editing the same account in the CRM go through this method.
	 *
	 * A single-document update is atomic in MongoDB, so expressing the whole change as one
	 * statement makes the race impossible rather than merely unlikely.
	 *
	 * ## Why the default case is a pipeline
	 *
	 * The obvious spelling — `$push` the new address and `$set` the others' `isDefault` to false —
	 * is REFUSED by the server: both operators address the `addresses` path, and MongoDB rejects
	 * an update whose operators conflict on one path. An aggregation pipeline has no such limit,
	 * because it computes the whole array in a single server-side expression: demote everything
	 * that is already there, then append. Still one document, still one atomic statement.
	 *
	 * `$literal` wraps the new address deliberately. Inside a pipeline a plain string beginning
	 * with `$` is a FIELD PATH, and these values come from a customer's own form — an address line
	 * of `"$email"` would otherwise interpolate the document into itself.
	 */
	async addAddress(customerId: string, address: Address): Promise<Customer | null> {
		const update = address.isDefault
			? [
					{
						$set: {
							addresses: {
								$concatArrays: [
									{
										$map: {
											input: { $ifNull: ['$addresses', []] },
											as: 'row',
											in: { $mergeObjects: ['$$row', { isDefault: false }] },
										},
									},
									{ $literal: [address] },
								],
							},
						},
					},
				]
			: { $push: { addresses: address } };

		// `updatePipeline` is mongoose 9 asking for the array form to be intentional rather than a
		// mistyped update document. It applies only to the default-claiming branch above.
		const doc = await CustomerModel.findByIdAndUpdate(customerId, update, {
			returnDocument: 'after',
			updatePipeline: Array.isArray(update),
		})
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	/**
	 * Patches one address in ONE atomic statement, touching only the fields supplied.
	 *
	 * Same reasoning as `addAddress`: nothing is read into memory and written back, so a
	 * concurrent write cannot be erased. Matching on the address id in the FILTER also keeps the
	 * "no such address" answer honest and the ownership check atomic, exactly as `deleteAddress`
	 * does.
	 *
	 * Only the supplied keys are written. The previous version rebuilt the whole object with
	 * `patch.x ?? current.x`, so an omitted field was rewritten with the value it already had —
	 * harmless alone, but it is what made every write a whole-array write, and it meant a field
	 * changed by somebody else in between was quietly reverted to the value this request had read.
	 *
	 * Paths are built from a FIXED list of contract fields rather than from the patch's own keys.
	 * A key that reached `addresses.$[target].${key}` unchecked would be a caller writing its own
	 * query path; Zod already strips unknown keys upstream, and this is the second lock on it.
	 */
	async updateAddress(
		customerId: string,
		addressId: string,
		patch: Partial<Omit<Address, 'id'>>,
	): Promise<Customer | null> {
		const set: Record<string, unknown> = {};
		for (const field of PATCHABLE_ADDRESS_FIELDS) {
			if (patch[field] !== undefined) set[`addresses.$[target].${field}`] = patch[field];
		}

		const options: Record<string, unknown> = {
			returnDocument: 'after',
			arrayFilters: [{ 'target.id': addressId }],
		};

		// Promoting one address to default demotes the others in the same statement, so the
		// account can never be seen with two defaults or none.
		if (patch.isDefault === true) {
			set['addresses.$[other].isDefault'] = false;
			(options.arrayFilters as unknown[]).push({ 'other.id': { $ne: addressId } });
		}

		const doc = await CustomerModel.findOneAndUpdate(
			{ _id: customerId, 'addresses.id': addressId },
			{ $set: set },
			options,
		)
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	/**
	 * Removes one saved address, and answers `null` when there was nothing to remove.
	 *
	 * The `$pull` alone cannot tell "removed it" from "there was no such address" — it reports
	 * success either way — so this matched on the address id as well as the customer id. Both
	 * callers were already written for null-on-missing and were therefore reporting 200 for a
	 * delete that did nothing, including for an id belonging to somebody else's account.
	 *
	 * Matching on both ids in ONE query also keeps the ownership check atomic: there is no window
	 * between reading the address and pulling it.
	 */
	async deleteAddress(customerId: string, addressId: string): Promise<Customer | null> {
		const doc = await CustomerModel.findOneAndUpdate(
			{ _id: customerId, 'addresses.id': addressId },
			{ $pull: { addresses: { id: addressId } } },
			{ returnDocument: 'after' },
		)
			.lean<CustomerDoc>()
			.exec();
		return doc ? mapCustomer(doc) : null;
	}

	/**
	 * Writes the customer row. Identities are NOT written here.
	 *
	 * This used to hand `customer.identities` to a delete-all-then-insert against
	 * `authIdentities`: every save wiped the subject's provider links and re-created them from
	 * whatever the caller happened to pass, outside any transaction. A failed insert left an
	 * account with no way in, and a caller holding a partial list — a signup passing only its own
	 * password entry, say — would have silently dropped a Google link it never knew about.
	 *
	 * `authIdentities` now has ONE writer, `AuthIdentityRepository`, which links and unlinks
	 * individually. `Customer.identities` remains a READ projection, loaded from that collection
	 * by `mapCustomer`, so what comes back still reflects reality — it is simply not a field this
	 * method accepts instructions through.
	 */
	async save(customer: Customer): Promise<Customer> {
		const { id, identities: _ignored, ...rest } = customer;
		try {
			const doc = await CustomerModel.findByIdAndUpdate(
				id,
				{ $set: rest },
				{
					upsert: true,
					returnDocument: 'after',
					setDefaultsOnInsert: true,
					// Joins the signup transaction, so the row and its credentials commit together.
					session: sessionFrom(),
				},
			)
				.lean<CustomerDoc>()
				.exec();
			return mapCustomer(doc as CustomerDoc);
		} catch (error) {
			// The unique index is the arbiter of who got the address; a caller that pre-checked
			// still has to hear its verdict as a refusal rather than as a 500.
			throw asDuplicateIdentifier(error) ?? error;
		}
	}

	async setPasswordHash(customerId: string, passwordHash: string): Promise<void> {
		await upsertPasswordCredential('customer', customerId, passwordHash);
	}
}

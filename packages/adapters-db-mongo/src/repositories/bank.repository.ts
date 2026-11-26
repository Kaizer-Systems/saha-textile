import { BankAccount } from '@saha-textile/contracts';
import type { BankRepository, TransactionContext } from '@saha-textile/core-domain';

import { BankAccountModel } from '../models/bank.model';
import type { AggregateDoc } from '../models/purchasing.model';
import { sessionFrom } from '../transaction-manager';

const accountOf = (doc: AggregateDoc): BankAccount => {
	const { _id, ...rest } = doc;
	return BankAccount.parse({ ...rest, id: _id });
};
const docOf = (account: BankAccount) => {
	const { id, ...rest } = account;
	return { _id: id, ...rest };
};

/** Bank accounts in MongoDB (`bankAccounts`). */
export class MongoBankRepository implements BankRepository {
	async list(): Promise<BankAccount[]> {
		const docs = await BankAccountModel.find({}).sort({ shortName: 1 }).lean<AggregateDoc[]>().exec();
		return docs.map(accountOf);
	}

	async get(id: string, context?: TransactionContext): Promise<BankAccount | null> {
		const doc = await BankAccountModel.findById(id)
			.session(sessionFrom(context) ?? null)
			.lean<AggregateDoc>()
			.exec();
		return doc ? accountOf(doc) : null;
	}

	async insert(account: BankAccount, context?: TransactionContext): Promise<void> {
		await BankAccountModel.create([docOf(account)], { session: sessionFrom(context) }).catch((error: unknown) => {
			if ((error as { code?: number }).code === 11000) throw new Error('bank_account_exists', { cause: error });
			throw error;
		});
	}

	async save(account: BankAccount, expectedVersion: number, context?: TransactionContext): Promise<BankAccount> {
		const next = { ...account, version: expectedVersion + 1 };
		const result = await BankAccountModel.replaceOne({ _id: account.id, version: expectedVersion }, docOf(next), {
			session: sessionFrom(context),
		}).exec();
		if (result.matchedCount === 0) throw new Error('bank_account_changed');
		return next;
	}
}

import { type Model, Schema, model, models } from 'mongoose';

export interface UserDoc {
	_id: string;
	email: string | null;
	emailVerified: boolean;
	displayName?: string;
	role: string;
	/** Secret — never mapped into the public User contract. */
	passwordHash: string | null;
	identities: unknown[];
	addresses: unknown[];
	guestCartId: string | null;
	consent?: Record<string, unknown>;
	createdAt?: Date;
	updatedAt?: Date;
}

const UserSchema = new Schema<UserDoc>(
	{
		_id: { type: String, required: true },
		email: { type: String, default: null },
		emailVerified: { type: Boolean, default: false },
		displayName: { type: String },
		role: { type: String, enum: ['customer', 'staff', 'admin'], default: 'customer' },
		passwordHash: { type: String, default: null, select: false },
		identities: { type: [Schema.Types.Mixed], default: [] },
		addresses: { type: [Schema.Types.Mixed], default: [] },
		guestCartId: { type: String, default: null },
		consent: { type: Schema.Types.Mixed },
	},
	{ timestamps: true },
);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });

export const UserModel: Model<UserDoc> = (models.User as Model<UserDoc>) ?? model<UserDoc>('User', UserSchema);

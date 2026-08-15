import { Customer } from '@saha-textile/contracts';

/**
 * Local/dev seed customers for All Customers list QA (search + pagination).
 *
 * Target ~70 rows so pageSize 30 yields 3 pages. Idempotent upsert by `cus_seed_NNN` ids.
 * Varied names/emails/phones/statuses so tokenized `q` search is easy to exercise.
 */

const FIRST = [
	'Priya',
	'Anjali',
	'Meera',
	'Rohan',
	'Sneha',
	'Aarav',
	'Diya',
	'Kabir',
	'Isha',
	'Vikram',
	'Naina',
	'Arjun',
	'Kavya',
	'Sahil',
	'Tanya',
	'Neha',
	'Rahul',
	'Pooja',
	'Amit',
	'Sonia',
	'Dev',
	'Ritika',
	'Kunal',
	'Aditi',
	'Manish',
	'Shreya',
	'Nikhil',
	'Pallavi',
	'Gaurav',
	'Rhea',
	'Harsh',
	'Megha',
	'Yash',
	'Ananya',
	'Rajat',
	'Simran',
	'Varun',
	'Ira',
	'Mohit',
	'Sana',
];

const LAST = [
	'Sharma',
	'Gupta',
	'Roy',
	'Banerjee',
	'Mukherjee',
	'Das',
	'Sen',
	'Chatterjee',
	'Patel',
	'Khan',
	'Singh',
	'Verma',
	'Nair',
	'Iyer',
	'Reddy',
	'Joshi',
	'Malhotra',
	'Kapoor',
	'Bose',
	'Dutta',
];

const CITIES: Array<{ city: string; state: string; postal: string }> = [
	{ city: 'Kolkata', state: 'West Bengal', postal: '700016' },
	{ city: 'Howrah', state: 'West Bengal', postal: '711101' },
	{ city: 'Mumbai', state: 'Maharashtra', postal: '400001' },
	{ city: 'Delhi', state: 'Delhi', postal: '110001' },
	{ city: 'Bengaluru', state: 'Karnataka', postal: '560001' },
	{ city: 'Chennai', state: 'Tamil Nadu', postal: '600001' },
	{ city: 'Hyderabad', state: 'Telangana', postal: '500001' },
	{ city: 'Pune', state: 'Maharashtra', postal: '411001' },
];

const STATUSES = ['active', 'active', 'active', 'pending', 'disabled', 'locked'] as const;

const SEED_COUNT = 70;

function pad(n: number): string {
	return String(n).padStart(3, '0');
}

function buildOne(index: number): Customer {
	const n = index + 1;
	const first = FIRST[index % FIRST.length]!;
	const last = LAST[Math.floor(index / FIRST.length) % LAST.length]!;
	const displayName = `${first} ${last}`;
	const slug = `${first}.${last}.${pad(n)}`.toLowerCase();
	const email = `${slug}@example.com`;
	const phoneTail = String(9000000000 + n).slice(0, 10);
	const phone = `+91${phoneTail}`;
	const status = STATUSES[index % STATUSES.length]!;
	const place = CITIES[index % CITIES.length]!;
	const withAddress = index % 3 !== 2;

	return Customer.parse({
		id: `cus_seed_${pad(n)}`,
		email,
		emailVerified: status === 'active',
		phone,
		phoneVerified: index % 2 === 0,
		displayName,
		status,
		identities: [{ provider: 'password', email }],
		addresses: withAddress
			? [
					{
						id: `addr_seed_${pad(n)}`,
						label: index % 2 === 0 ? 'Home' : 'Office',
						fullName: displayName,
						line1: `${10 + (index % 90)} Sample Street`,
						line2: index % 4 === 0 ? 'Near Market' : undefined,
						city: place.city,
						state: place.state,
						postalCode: place.postal,
						country: 'IN',
						phone,
						isDefault: true,
					},
				]
			: [],
		contacts: [],
		savedSizes: [],
		measurementProfiles: [],
		guestCartId: null,
	});
}

/** ~70 customers for three pages at table pageSize 30. */
export const seedCustomers: Customer[] = Array.from({ length: SEED_COUNT }, (_, i) => buildOne(i));

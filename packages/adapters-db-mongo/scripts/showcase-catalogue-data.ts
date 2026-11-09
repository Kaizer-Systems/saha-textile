/**
 * Words for the local showcase catalogue. The category tree is the menu of sahatextile.com, and
 * the weave, motif and garment names are the ones the trade uses. The Bengali follows the glossary
 * in the owner decision round "Bengali replaces French" (2026-11-08) and is read by the owner like
 * every other Bengali string (`DEC-TRANSLATION-QUALITY`).
 */

import { MOTIFS_BN } from './showcase-catalogue-motifs-bn';

export interface Words {
	[locale: string]: string;
	en: string;
	bn: string;
}

/** A motif name with its Bengali; a name missing from the table stops the build. */
const motif = (name: string): Words => {
	const bn = MOTIFS_BN[name];
	if (!bn) throw new Error(`No Bengali for the motif "${name}"`);
	return { en: name, bn };
};

export interface ColourWord extends Words {
	/** The filter colour this shade belongs to. */
	family: string;
}

export const COLOURS: readonly ColourWord[] = [
	{ en: 'Ruby Red', bn: 'রুবি লাল', family: 'Red' },
	{ en: 'Sindoor Red', bn: 'সিঁদুরে লাল', family: 'Red' },
	{ en: 'Rani Pink', bn: 'রানি গোলাপি', family: 'Pink' },
	{ en: 'Onion Pink', bn: 'পেঁয়াজি গোলাপি', family: 'Pink' },
	{ en: 'Peacock Blue', bn: 'ময়ূরকণ্ঠী নীল', family: 'Blue' },
	{ en: 'Midnight Blue', bn: 'গাঢ় নীল', family: 'Blue' },
	{ en: 'Royal Blue', bn: 'রয়্যাল ব্লু', family: 'Blue' },
	{ en: 'Bottle Green', bn: 'বোতল সবুজ', family: 'Green' },
	{ en: 'Mehendi Green', bn: 'মেহেন্দি সবুজ', family: 'Green' },
	{ en: 'Parrot Green', bn: 'টিয়া সবুজ', family: 'Green' },
	{ en: 'Sea Green', bn: 'সি গ্রিন', family: 'Teal' },
	{ en: 'Teal', bn: 'টিল', family: 'Teal' },
	{ en: 'Mustard Yellow', bn: 'সর্ষে হলুদ', family: 'Mustard' },
	{ en: 'Turmeric Yellow', bn: 'কাঁচা হলুদ', family: 'Mustard' },
	{ en: 'Burnt Orange', bn: 'পোড়া কমলা', family: 'Rust' },
	{ en: 'Rust', bn: 'মরচে রং', family: 'Rust' },
	{ en: 'Wine', bn: 'ওয়াইন', family: 'Wine' },
	{ en: 'Maroon', bn: 'মেরুন', family: 'Maroon' },
	{ en: 'Magenta', bn: 'ম্যাজেন্টা', family: 'Magenta' },
	{ en: 'Lavender', bn: 'ল্যাভেন্ডার', family: 'Lavender' },
	{ en: 'Ivory', bn: 'আইভরি', family: 'Ivory' },
	{ en: 'Off White', bn: 'অফ হোয়াইট', family: 'Ivory' },
	{ en: 'Charcoal Black', bn: 'কয়লা কালো', family: 'Black' },
	{ en: 'Antique Gold', bn: 'অ্যান্টিক গোল্ড', family: 'Gold' },
];

/** Filter colours, with the swatch each shows. */
export const COLOUR_FAMILIES: Readonly<Record<string, string>> = {
	Red: '#b3202a',
	Pink: '#e0528a',
	Blue: '#1f4e96',
	Green: '#1f7a4d',
	Teal: '#0f7c7c',
	Mustard: '#d1a11f',
	Rust: '#b5521b',
	Wine: '#6d1b3a',
	Maroon: '#6b1420',
	Magenta: '#b5157d',
	Lavender: '#a58bd1',
	Ivory: '#f2ead8',
	Black: '#1c1c1c',
	Gold: '#c79a3b',
};

export interface Family {
	motifs: readonly Words[];
	/** Filter values. */
	fabric: string;
	work: readonly string[];
	pattern: readonly string[];
	occasion: readonly string[];
	priceINR: readonly [number, number];
	hsn: string;
	weightGrams: number;
	story: Words;
	/** Silk that can carry a stitched blouse option or wait for the loom. */
	tailored?: boolean;
}

const list = (names: string): Words[] => names.split(', ').map(motif);

export const FAMILIES: Readonly<Record<string, Family>> = {
	banarasi: {
		motifs: list(
			'Meenakari Jangla, Kadhua Buti, Rangkat, Shikargah, Tanchoi, Kalga Bel, Ashrafi Buti, Mughal Jaal, Konia Bel, Jamawar, Phekwa Buti, Tilfi',
		),
		fabric: 'Silk',
		work: ['Zari', 'Meenakari'],
		pattern: ['Floral', 'Geometric'],
		occasion: ['Wedding', 'Festive'],
		priceINR: [8500, 42000],
		hsn: '5007',
		weightGrams: 780,
		story: {
			en: 'Handwoven in Varanasi on a pit loom, with real zari and a rich pallu.',
			bn: 'বারাণসীর তাঁতে হাতে বোনা, আসল জরি আর জমকালো আঁচল।',
		},
		tailored: true,
	},
	kanchipuram: {
		motifs: list(
			'Korvai Border, Temple Border, Rudraksham, Mayil Chakram, Annapakshi, Vanasingaram, Yazhi, Thandavalam, Muthu Kattam, Pettu Border, Mallimoggu, Gopuram',
		),
		fabric: 'Silk',
		work: ['Zari', 'Woven'],
		pattern: ['Geometric', 'Floral'],
		occasion: ['Wedding', 'Festive'],
		priceINR: [12000, 65000],
		hsn: '5007',
		weightGrams: 820,
		story: {
			en: 'Woven in Tamil Nadu from mulberry silk, with the heavy border the region is known for.',
			bn: 'তামিলনাড়ুর মালবেরি সিল্কে বোনা, সঙ্গে সেই ভারী পাড় যার জন্য এই অঞ্চলের নাম।',
		},
		tailored: true,
	},
	gadwal: {
		motifs: list(
			'Kuttu Border, Sico Body, Kumbam Pallu, Reku Border, Temple Kuttu, Rudraksha Buti, Checks, Chilakalu, Jari Kuttu, Plain Body, Kothakota, Pochampally Border',
		),
		fabric: 'Silk',
		work: ['Zari', 'Woven'],
		pattern: ['Checks', 'Plain'],
		occasion: ['Wedding', 'Festive'],
		priceINR: [7500, 26000],
		hsn: '5007',
		weightGrams: 700,
		story: {
			en: 'From Telangana: a light cotton body joined to a silk border and pallu by hand.',
			bn: 'তেলেঙ্গানার শাড়ি: হালকা সুতির জমির সঙ্গে হাতে জোড়া সিল্কের পাড় আর আঁচল।',
		},
		tailored: true,
	},
	paithani: {
		motifs: list(
			'Muniya Border, Asawali, Narli Border, Peacock Pallu, Lotus Pallu, Bangadi Mor, Tota Maina, Ajanta Lotus, Kamal Pallu, Mor Buti, Rui Phool, Barwa Border',
		),
		fabric: 'Silk',
		work: ['Zari', 'Woven'],
		pattern: ['Floral'],
		occasion: ['Wedding', 'Festive'],
		priceINR: [14000, 58000],
		hsn: '5007',
		weightGrams: 760,
		story: {
			en: 'Tapestry woven in Yeola, Maharashtra, so the pallu reads the same on both sides.',
			bn: 'মহারাষ্ট্রের ইয়েওলায় ট্যাপেস্ট্রি বুননে তৈরি, তাই আঁচল দুই দিক থেকেই একই রকম দেখায়।',
		},
		tailored: true,
	},
	silk: {
		motifs: list(
			'Khaddi Jaal, Rangkat Border, Satin Border, Kadwa Buta, Booti Weave, Zari Stripe, Gold Bel, Paisley Buta, Jaal Weave, Plain Pallu, Tissue Pallu, Temple Motif',
		),
		fabric: 'Silk',
		work: ['Zari', 'Woven'],
		pattern: ['Floral', 'Striped'],
		occasion: ['Wedding', 'Festive', 'Party'],
		priceINR: [6500, 28000],
		hsn: '5007',
		weightGrams: 680,
		story: {
			en: 'Pure silk with a soft fall, finished by hand and checked piece by piece in Kolkata.',
			bn: 'নরম ঝুলের খাঁটি সিল্ক, কলকাতায় হাতে ফিনিশ করে প্রতিটি পিস আলাদা করে দেখে নেওয়া।',
		},
		tailored: true,
	},
	ikkat: {
		motifs: list(
			'Pochampally Double Ikkat, Sambalpuri Bandha, Telia Rumal, Nuapatna Bomkai, Patola Elephant, Pasapali Checks, Rudraksha Ikkat, Fish Motif, Shankha Motif, Lotus Ikkat, Diamond Ikkat, Parrot Ikkat',
		),
		fabric: 'Silk',
		work: ['Woven'],
		pattern: ['Geometric'],
		occasion: ['Festive', 'Office'],
		priceINR: [7000, 24000],
		hsn: '5007',
		weightGrams: 640,
		story: {
			en: 'Each yarn is resist-dyed before weaving, so the pattern appears with a soft, feathered edge.',
			bn: 'বোনার আগেই সুতো বেঁধে রং করা হয়, তাই নকশার কিনারা নরম, পালকের মতো।',
		},
	},
	jamdani: {
		motifs: list(
			'Panna Hazar, Butidar, Tercha, Jhalar, Phulwar, Duria, Tanchi, Kalka, Shabnam, Nakshi Buti, Jali Weave, Chand Tara',
		),
		fabric: 'Cotton',
		work: ['Woven'],
		pattern: ['Floral', 'Geometric'],
		occasion: ['Festive', 'Office', 'Casual'],
		priceINR: [4500, 28000],
		hsn: '5208',
		weightGrams: 420,
		story: {
			en: 'Discontinuous weft work done by hand, a craft listed by UNESCO, on a fine and airy ground.',
			bn: 'মিহি, হালকা জমিতে হাতে তোলা নকশা; ইউনেস্কোর স্বীকৃতি পাওয়া বুননশিল্প।',
		},
	},
	bengal: {
		motifs: list(
			'Tant Border, Begampuri, Dhaniakhali Stripe, Shantipuri Par, Phulia Weave, Khadi Check, Matha Par, Laal Paar, Tangail Buti, Baluchari Border, Kantha Pallu, Fulkari Par',
		),
		fabric: 'Cotton',
		work: ['Woven'],
		pattern: ['Striped', 'Checks'],
		occasion: ['Daily Wear', 'Office', 'Casual'],
		priceINR: [1200, 4500],
		hsn: '5208',
		weightGrams: 480,
		story: {
			en: 'Woven by Bengal handloom clusters, crisp to wear and easy through a long humid day.',
			bn: 'বাংলার তাঁতিদের হাতে বোনা; পরলে টানটান, গরম আর ভ্যাপসা লম্বা দিনেও আরামের।',
		},
	},
	jaipur: {
		motifs: list(
			'Sanganeri Buti, Bagru Dabu, Ajrakh Jaal, Indigo Dabu, Hand Block Paisley, Mughal Booti, Kashish Print, Lehariya, Bandhani Print, Floral Bel, Mango Buti, Syahi Begar',
		),
		fabric: 'Cotton',
		work: ['Print'],
		pattern: ['Floral', 'Geometric'],
		occasion: ['Casual', 'Office', 'Daily Wear'],
		priceINR: [1400, 3800],
		hsn: '5208',
		weightGrams: 450,
		story: {
			en: 'Hand block printed in Rajasthan, so small changes from piece to piece are part of the work.',
			bn: 'রাজস্থানে হাতে ব্লক প্রিন্ট করা, তাই প্রতিটি পিসে ছোটখাটো তফাত এই কাজেরই অংশ।',
		},
	},
	organic: {
		motifs: list(
			'Kala Cotton, Natural Indigo, Madder Red Stripe, Khadi Slub, Undyed Weave, Pomegranate Dye, Kora Check, Turmeric Dye, Vegetable Dye Stripe, Handspun Weave, Herbal Dye, Soft Mul',
		),
		fabric: 'Cotton',
		work: ['Woven'],
		pattern: ['Plain', 'Striped'],
		occasion: ['Daily Wear', 'Office'],
		priceINR: [1800, 4800],
		hsn: '5208',
		weightGrams: 430,
		story: {
			en: 'Organically grown cotton coloured with plant dyes, gentle on skin and light to carry.',
			bn: 'অর্গানিক সুতি, গাছের রঙে রাঙানো; ত্বকে নরম, পরতে হালকা।',
		},
	},
	south: {
		motifs: list(
			'Chettinad Checks, Mangalgiri Nizam Border, Venkatagiri Jamdani, Kovai Kora, Narayanpet Border, Sungudi Dots, Uppada Weave, Dharwad Stripe, Kandangi, Ilkal Pallu, Kasavu Border, Coimbatore Check',
		),
		fabric: 'Cotton',
		work: ['Woven'],
		pattern: ['Checks', 'Striped'],
		occasion: ['Office', 'Daily Wear', 'Festive'],
		priceINR: [1600, 5200],
		hsn: '5208',
		weightGrams: 520,
		story: {
			en: 'Firm South Indian handloom cotton with a contrast border, made for everyday drape.',
			bn: 'দক্ষিণ ভারতের মজবুত তাঁতের সুতি, বিপরীত রঙের পাড়, রোজকার পরার জন্য।',
		},
	},
	kalamkari: {
		motifs: list(
			'Srikalahasti Tree of Life, Pedana Block, Peacock Kalamkari, Krishna Leela, Lotus Pond, Elephant Procession, Mango Grove, Ramayana Panel, Vine Scroll, Dancing Figures, Parrot Pair, Temple Chariot',
		),
		fabric: 'Cotton',
		work: ['Print'],
		pattern: ['Floral'],
		occasion: ['Festive', 'Office', 'Casual'],
		priceINR: [1500, 6200],
		hsn: '5208',
		weightGrams: 470,
		story: {
			en: 'Pen-drawn or block printed in Andhra Pradesh with natural dyes and traditional scenes.',
			bn: 'অন্ধ্রপ্রদেশে কলমে আঁকা বা ব্লক প্রিন্ট করা, প্রাকৃতিক রং আর চিরাচরিত দৃশ্য।',
		},
	},
	semi: {
		motifs: list(
			'Zari Border, Booti Weave, Temple Border, Contrast Pallu, Floral Jaal, Stripe Weave, Paisley Buta, Tissue Border, Checks, Mango Buti, Peacock Pallu, Gold Stripe',
		),
		fabric: 'Blended Silk',
		work: ['Zari', 'Woven'],
		pattern: ['Floral', 'Striped'],
		occasion: ['Festive', 'Party', 'Office'],
		priceINR: [1800, 6500],
		hsn: '5407',
		weightGrams: 560,
		story: {
			en: 'A silk blend with the look of pure silk at a kinder price, and easy to look after.',
			bn: 'দেখতে খাঁটি সিল্কের মতো, দামে সাশ্রয়ী, যত্ন নেওয়াও সহজ।',
		},
	},
	party: {
		motifs: list(
			'Cutdana Border, Mirror Work, Sequin Bel, Stone Pallu, Thread Jaal, Ombre Sequin, Pearl Border, Resham Bel, Scallop Border, Crystal Buti, Gota Patti, Zardosi Border',
		),
		fabric: 'Georgette',
		work: ['Sequins', 'Embroidered', 'Stone'],
		pattern: ['Floral', 'Plain'],
		occasion: ['Party', 'Festive'],
		priceINR: [2500, 12000],
		hsn: '5407',
		weightGrams: 610,
		story: {
			en: 'Hand finished embellishment on a fluid base, made to catch the light in the evening.',
			bn: 'হালকা, ঝুলে পড়া কাপড়ে হাতে করা কারুকাজ, সন্ধের আলোয় ঝলমল করার জন্য।',
		},
	},
	budget: {
		motifs: list(
			'Floral Print, Polka Dot, Laal Paar, Zari Stripe, Leaf Print, Ombre Print, Check Weave, Border Print, Paisley Print, Geometric Print, Bandhani Print, Temple Stripe',
		),
		fabric: 'Blended Silk',
		work: ['Print', 'Woven'],
		pattern: ['Floral', 'Geometric'],
		occasion: ['Casual', 'Daily Wear', 'Office'],
		priceINR: [499, 1800],
		hsn: '5407',
		weightGrams: 430,
		story: {
			en: 'An easy everyday piece at a gentle price, light to drape and quick to wash.',
			bn: 'রোজ পরার সহজ শাড়ি, সাশ্রয়ী দামে; হালকা, পরতে সহজ, ধুতেও ঝামেলা নেই।',
		},
	},
	printed: {
		motifs: list(
			'Floral Vine, Digital Paisley, Madhubani Art, Warli Art, Pichwai Lotus, Abstract Wave, Ajrakh Print, Shibori, Mughal Garden, Leaf Print, Peacock Print, Kantha Print',
		),
		fabric: 'Silk',
		work: ['Print'],
		pattern: ['Floral', 'Geometric'],
		occasion: ['Office', 'Party', 'Casual'],
		priceINR: [900, 4500],
		hsn: '5007',
		weightGrams: 460,
		story: {
			en: 'Printed in fine detail, with colour that stays clear after careful washing.',
			bn: 'সূক্ষ্ম প্রিন্ট; যত্ন করে ধুলে রং থাকে উজ্জ্বল।',
		},
	},
	suits: {
		motifs: list(
			'Lucknowi Shadow Work, Phanda Murri, Jaali Chikan, Gota Patti, Zari Yoke, Mirror Yoke, Resham Neck, Bandhani, Ajrakh Panel, Kashmiri Aari, Phulkari Dupatta, Floral Jaal, Mukaish, Kantha Stitch, Block Print Panel, Banarasi Brocade',
		),
		fabric: 'Cotton',
		work: ['Embroidered', 'Print', 'Zari'],
		pattern: ['Floral', 'Plain'],
		occasion: ['Festive', 'Party', 'Casual', 'Office'],
		priceINR: [1200, 9500],
		hsn: '6204',
		weightGrams: 520,
		story: {
			en: 'A full set with top, bottom and dupatta, cut generously so a tailor can fit it to you.',
			bn: 'টপ, বটম আর ওড়না নিয়ে পুরো সেট, যথেষ্ট কাপড় রেখে কাটা, যাতে দর্জি আপনার মাপে বানাতে পারেন।',
		},
	},
};

export interface Leaf {
	/** Canonical path under `/collections/`. */
	path: string;
	name: string;
	family: string;
	/** How many products this category holds. */
	count: number;
	/** The product noun in a title. */
	noun?: Words;
	fabric?: string;
}

const leaves = (
	group: string,
	family: string,
	rows: ReadonlyArray<[string, string, number?, Partial<Leaf>?]>,
): Leaf[] =>
	rows.map(([slug, name, count, extra]) => ({
		path: `${group}/${slug}`,
		name,
		family,
		count: count ?? 12,
		...extra,
	}));

/** The garments a dress material comes as, so one category shows the range a shop carries. */
export const GARMENTS: readonly Words[] = [
	{ en: 'Salwar Suit', bn: 'সালোয়ার স্যুট' },
	{ en: 'Anarkali Suit', bn: 'আনারকলি স্যুট' },
	{ en: 'Churidar Suit', bn: 'চুড়িদার স্যুট' },
	{ en: 'Patiala Suit', bn: 'পাতিয়ালা স্যুট' },
	{ en: 'Palazzo Suit', bn: 'পালাজো স্যুট' },
	{ en: 'Sharara Suit', bn: 'শারারা স্যুট' },
	{ en: 'Straight Cut Suit', bn: 'স্ট্রেট কাট স্যুট' },
	{ en: 'Unstitched Suit Material', bn: 'সেলাই ছাড়া স্যুটের কাপড়' },
	{ en: 'Kurta Dupatta Set', bn: 'কুর্তা-ওড়না সেট' },
	{ en: 'Dress Material', bn: 'ড্রেস মেটেরিয়াল' },
];

/** The category tree of the live site's menu, with the same spelling where it was right. */
export const LEAVES: readonly Leaf[] = [
	...leaves('sarees/pure-silk', 'banarasi', [
		['katan-banarasi', 'Katan Banarasi', 20],
		['tussar-banarasi', 'Tussar Banarasi'],
	]),
	...leaves('sarees/pure-silk', 'kanchipuram', [['kanchipuram', 'Kanchipuram', 16]]),
	...leaves('sarees/pure-silk', 'gadwal', [['gadwal', 'Gadwal']]),
	...leaves('sarees/pure-silk', 'paithani', [['paithani', 'Paithani']]),
	...leaves('sarees/pure-silk', 'silk', [
		['khaddi', 'Khaddi'],
		['shehnai-collection', 'Shehnai Collection'],
		['georgette', 'Georgette', 12, { noun: { en: 'Pure Georgette Saree', bn: 'খাঁটি জর্জেট শাড়ি' } }],
	]),
	...leaves('sarees/pure-silk', 'banarasi', [['wedding-banarasi', 'Wedding Banarasi', 14]]),
	...leaves('sarees/pure-silk', 'kanchipuram', [['arni', 'Arni']]),
	...leaves('sarees/pure-silk', 'ikkat', [
		['ikkat', 'Ikkat', 12, { noun: { en: 'Ikkat Silk Saree', bn: 'ইক্কত সিল্ক শাড়ি' } }],
	]),
	...leaves('sarees/jamdani', 'jamdani', [
		['traditional-jamdani', 'Traditional Jamdani'],
		['muslin-jamdani', 'Muslin Jamdani'],
		['linen-jamdani', 'Linen Jamdani', 12, { fabric: 'Linen' }],
		['tussar-jamdani', 'Tussar Jamdani', 12, { fabric: 'Tussar' }],
		['royal-jamdani', 'Royal Jamdani'],
		['dhakai-jamdani', 'Dhakai Jamdani', 14],
	]),
	...leaves('sarees/pure-cotton', 'bengal', [['bengal-handloom-cotton', 'Bengal Handloom Cotton']]),
	...leaves('sarees/pure-cotton', 'jaipur', [['jaipur-print', 'Jaipur Print']]),
	...leaves('sarees/pure-cotton', 'organic', [['organic-cotton', 'Organic Cotton']]),
	...leaves('sarees/pure-cotton', 'south', [['south-cotton', 'South Cotton']]),
	...leaves('sarees/pure-cotton', 'kalamkari', [['cotton-kalamkari', 'Cotton Kalamkari']]),
	...leaves('sarees/pure-cotton', 'jamdani', [['cotton-jamdani', 'Cotton Jamdani']]),
	...leaves('sarees/semi-silk', 'semi', [
		['semi-tussar', 'Semi Tussar'],
		['semi-organza', 'Semi Organza'],
		['semi-katan', 'Semi Katan'],
		['sico', 'Sico'],
		['premium-semi-katan', 'Premium Semi Katan'],
		['semi-khaddi', 'Semi Khaddi'],
		['shagun', 'Shagun'],
		['semi-linen', 'Semi Linen'],
		['semi-crepe', 'Semi Crepe'],
		['semi-tissue', 'Semi Tissue'],
		['semi-kora', 'Semi Kora'],
	]),
	...leaves('sarees/party-wear', 'party', [
		['organza', 'Organza', 12, { fabric: 'Organza' }],
		['net', 'Net', 12, { fabric: 'Net' }],
		['georgette', 'Georgette', 12, { noun: { en: 'Party Georgette Saree', bn: 'পার্টি জর্জেট শাড়ি' } }],
		['chiffon', 'Chiffon', 12, { fabric: 'Chiffon' }],
		[
			'sarees-with-ready-blouse',
			'Sarees with Ready Blouse',
			12,
			{ noun: { en: 'Saree with Ready Blouse', bn: 'রেডিমেড ব্লাউজ সহ শাড়ি' } },
		],
		[
			'embroidered',
			'Embroidered',
			12,
			{ noun: { en: 'Embroidered Party Saree', bn: 'এমব্রয়ডারি করা পার্টি শাড়ি' } },
		],
		['stone-work', 'Stone Work', 12, { noun: { en: 'Stone Work Saree', bn: 'স্টোনের কাজের শাড়ি' } }],
		['tissue', 'Tissue', 12, { fabric: 'Tissue' }],
		['sequins', 'Sequins', 12, { noun: { en: 'Sequin Saree', bn: 'চুমকির কাজের শাড়ি' } }],
	]),
	...leaves('sarees/budget-range', 'budget', [
		['chanderi', 'Chanderi'],
		['supernet', 'Supernet'],
		['printed-chiffon', 'Printed Chiffon', 12, { fabric: 'Chiffon' }],
		['red-and-white', 'Red & White', 12, { noun: { en: 'Red & White Bengal Saree', bn: 'লাল-সাদা বাংলার শাড়ি' } }],
		[
			'embroidered-sarees',
			'Embroidered Sarees',
			12,
			{ noun: { en: 'Embroidered Saree', bn: 'এমব্রয়ডারি করা শাড়ি' } },
		],
		['printed-silks', 'Printed Silks', 12, { noun: { en: 'Printed Silk Saree', bn: 'প্রিন্টেড সিল্ক শাড়ি' } }],
		['silk-kota', 'Silk Kota'],
		['printed-kalamkari', 'Printed Kalamkari'],
	]),
	...leaves('sarees/printed', 'printed', [
		['pure-silk', 'Pure Silk', 12, { noun: { en: 'Printed Pure Silk Saree', bn: 'প্রিন্টেড খাঁটি সিল্ক শাড়ি' } }],
		[
			'tussar',
			'Tussar',
			12,
			{ noun: { en: 'Printed Tussar Silk Saree', bn: 'প্রিন্টেড তসর সিল্ক শাড়ি' }, fabric: 'Tussar' },
		],
		[
			'chiffon',
			'Chiffon',
			12,
			{ noun: { en: 'Printed Chiffon Saree', bn: 'প্রিন্টেড শিফন শাড়ি' }, fabric: 'Chiffon' },
		],
		['crepe', 'Crepe', 12, { noun: { en: 'Printed Crepe Saree', bn: 'প্রিন্টেড ক্রেপ শাড়ি' }, fabric: 'Crepe' }],
		['printed-tussar', 'Printed Tussar', 12, { fabric: 'Tussar' }],
		['kalamkari', 'Kalamkari', 12, { noun: { en: 'Kalamkari Print Saree', bn: 'কলমকারি প্রিন্ট শাড়ি' } }],
		['naksha-e-mughal', 'Naksha-e-Mughal'],
		['kora', 'Kora', 12, { noun: { en: 'Printed Kora Saree', bn: 'প্রিন্টেড কোরা শাড়ি' } }],
		[
			'organza',
			'Organza',
			12,
			{ noun: { en: 'Printed Organza Saree', bn: 'প্রিন্টেড অর্গাঞ্জা শাড়ি' }, fabric: 'Organza' },
		],
		['banarasi', 'Banarasi', 12, { noun: { en: 'Printed Banarasi Saree', bn: 'প্রিন্টেড বেনারসি শাড়ি' } }],
		[
			'tissue-banarasi',
			'Tissue Banarasi',
			12,
			{ noun: { en: 'Printed Tissue Banarasi Saree', bn: 'প্রিন্টেড টিস্যু বেনারসি শাড়ি' }, fabric: 'Tissue' },
		],
	]),
	...leaves('dress-materials', 'suits', [
		['cotton-chikankari', 'Cotton Chikankari', 40, { noun: { en: 'Cotton Chikankari', bn: 'সুতির চিকনকারি' } }],
		[
			'georgette-chikankari',
			'Georgette Chikankari',
			40,
			{ noun: { en: 'Georgette Chikankari', bn: 'জর্জেট চিকনকারি' }, fabric: 'Georgette' },
		],
		['printed', 'Printed', 40, { noun: { en: 'Printed Cotton', bn: 'প্রিন্টেড সুতি' } }],
		['banarasi', 'Banarasi', 40, { noun: { en: 'Banarasi Silk', bn: 'বেনারসি সিল্ক' }, fabric: 'Silk' }],
		['embroidered', 'Embroidered', 40, { noun: { en: 'Embroidered', bn: 'এমব্রয়ডারি করা' }, fabric: 'Georgette' }],
		[
			'party-wear-suits',
			'Party Wear Suits',
			40,
			{ noun: { en: 'Party Wear', bn: 'পার্টি ওয়্যার' }, fabric: 'Georgette' },
		],
	]),
];

/** Groups of the menu, with the order the live site shows them. */
export const GROUPS: ReadonlyArray<{ path: string; name: string }> = [
	{ path: 'sarees', name: 'Sarees' },
	{ path: 'sarees/pure-silk', name: 'Pure Silk' },
	{ path: 'sarees/jamdani', name: 'Jamdani' },
	{ path: 'sarees/pure-cotton', name: 'Pure Cotton' },
	{ path: 'sarees/semi-silk', name: 'Semi Silk' },
	{ path: 'sarees/party-wear', name: 'Party Wear' },
	{ path: 'sarees/budget-range', name: 'Budget Range' },
	{ path: 'sarees/printed', name: 'Printed' },
	{ path: 'dress-materials', name: 'Dress Materials' },
];

/** The same category reached from a second branch of the menu. */
export const SECOND_PLACEMENTS: ReadonlyArray<{ path: string; alsoUnder: string }> = [
	{ path: 'sarees/pure-cotton/cotton-jamdani', alsoUnder: 'sarees/jamdani' },
	{ path: 'sarees/budget-range/printed-kalamkari', alsoUnder: 'sarees/printed' },
	{ path: 'sarees/pure-silk/tussar-banarasi', alsoUnder: 'sarees/party-wear' },
];

export const SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
export const BLOUSE_SIZES = ['34', '36', '38', '40', '42'] as const;

/**
 * Filter values the title already states. A shopper who filters by Work, Pattern or Fabric and sees
 * a "Meenakari Jangla" saree under Zari stops trusting the filter, so a word in the title wins over
 * the family's default. The first matching rule wins; a title with no rule keeps the fallback.
 */
const WORK_RULES: ReadonlyArray<readonly [RegExp, string]> = [
	[/Meenakari/i, 'Meenakari'],
	[/Sequin|Cutdana|Crystal/i, 'Sequins'],
	[/Stone|Pearl/i, 'Stone'],
	[
		/Mukaish|Gota Patti|Mirror|Chikan|Phulkari|Aari|Resham|Thread|Shadow Work|Kantha|Zardosi|Embroider|Phanda/i,
		'Embroidered',
	],
	[/Kalamkari|Ajrakh|Bagru|Dabu|Bandhani|Print/i, 'Print'],
	[/Zari|Kadhua|Kadwa|Rangkat|Jangla|Ashrafi|Korvai|Brocade|Tanchoi|Shikargah/i, 'Zari'],
];

const PATTERN_RULES: ReadonlyArray<readonly [RegExp, string]> = [
	[/Stripe/i, 'Striped'],
	[/Check/i, 'Checks'],
	[/Floral|Rose|Lotus|Flower/i, 'Floral'],
	[/Ikk?at|Geometric|Chevron|Diamond/i, 'Geometric'],
	[/\bPlain\b/i, 'Plain'],
];

/** "Semi Organza" is a blend, so only a fabric named without "Semi" counts. */
const FABRICS = ['Georgette', 'Organza', 'Tissue', 'Linen', 'Crepe', 'Chiffon', 'Net', 'Cotton', 'Tussar'] as const;

const firstRule = (rules: ReadonlyArray<readonly [RegExp, string]>, title: string): string | undefined =>
	rules.find(([pattern]) => pattern.test(title))?.[1];

export function workFor(title: string, fallback: string): string {
	return firstRule(WORK_RULES, title) ?? fallback;
}

export function patternFor(title: string, fallback: string): string {
	return firstRule(PATTERN_RULES, title) ?? fallback;
}

/** The one fabric the title names; none, or two (a "Cotton Silk"), keeps the fallback. */
export function fabricFor(title: string, fallback: string): string {
	const named = FABRICS.filter((fabric) => new RegExp(`(?<!Semi )\\b${fabric}\\b`, 'i').test(title));
	const silk = /(?<!Semi )\bSilk\b/i.test(title) && named.length > 0;
	return named.length === 1 && !silk ? (named[0] as string) : fallback;
}

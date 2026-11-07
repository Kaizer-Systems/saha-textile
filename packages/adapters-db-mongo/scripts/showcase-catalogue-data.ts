/**
 * Words for the local showcase catalogue. The category tree is the menu of sahatextile.com, and
 * the weave, motif and garment names are the ones the trade uses. French is best effort, for
 * review like any other French (`DEC-TRANSLATION-QUALITY`).
 */

export interface Words {
	[locale: string]: string;
	en: string;
	fr: string;
}

const same = (name: string): Words => ({ en: name, fr: name });

export interface ColourWord extends Words {
	/** The filter colour this shade belongs to. */
	family: string;
}

export const COLOURS: readonly ColourWord[] = [
	{ en: 'Ruby Red', fr: 'rouge rubis', family: 'Red' },
	{ en: 'Sindoor Red', fr: 'rouge sindoor', family: 'Red' },
	{ en: 'Rani Pink', fr: 'rose rani', family: 'Pink' },
	{ en: 'Onion Pink', fr: 'rose oignon', family: 'Pink' },
	{ en: 'Peacock Blue', fr: 'bleu paon', family: 'Blue' },
	{ en: 'Midnight Blue', fr: 'bleu nuit', family: 'Blue' },
	{ en: 'Royal Blue', fr: 'bleu roi', family: 'Blue' },
	{ en: 'Bottle Green', fr: 'vert bouteille', family: 'Green' },
	{ en: 'Mehendi Green', fr: 'vert henné', family: 'Green' },
	{ en: 'Parrot Green', fr: 'vert perroquet', family: 'Green' },
	{ en: 'Sea Green', fr: 'vert d’eau', family: 'Teal' },
	{ en: 'Teal', fr: 'sarcelle', family: 'Teal' },
	{ en: 'Mustard Yellow', fr: 'jaune moutarde', family: 'Mustard' },
	{ en: 'Turmeric Yellow', fr: 'jaune curcuma', family: 'Mustard' },
	{ en: 'Burnt Orange', fr: 'orange brûlé', family: 'Rust' },
	{ en: 'Rust', fr: 'rouille', family: 'Rust' },
	{ en: 'Wine', fr: 'lie-de-vin', family: 'Wine' },
	{ en: 'Maroon', fr: 'bordeaux', family: 'Maroon' },
	{ en: 'Magenta', fr: 'magenta', family: 'Magenta' },
	{ en: 'Lavender', fr: 'lavande', family: 'Lavender' },
	{ en: 'Ivory', fr: 'ivoire', family: 'Ivory' },
	{ en: 'Off White', fr: 'blanc cassé', family: 'Ivory' },
	{ en: 'Charcoal Black', fr: 'noir charbon', family: 'Black' },
	{ en: 'Antique Gold', fr: 'or antique', family: 'Gold' },
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

const list = (names: string): Words[] => names.split(', ').map(same);

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
			fr: 'Tissé à la main à Varanasi sur métier à fosse, avec un vrai zari et un pallu riche.',
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
			fr: 'Tissé au Tamil Nadu en soie de mûrier, avec la bordure lourde qui fait la réputation de la région.',
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
			fr: 'Du Telangana : un corps de coton léger assemblé à la main à une bordure et un pallu en soie.',
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
			fr: 'Tissé en tapisserie à Yeola, au Maharashtra : le pallu se lit de la même façon des deux côtés.',
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
			fr: 'Pure soie au tombé souple, finie à la main et vérifiée pièce par pièce à Calcutta.',
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
			fr: 'Chaque fil est teint en réserve avant le tissage : le motif apparaît avec un bord doux et plumeux.',
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
			fr: 'Travail de trame discontinue fait à la main, un savoir-faire inscrit à l’UNESCO, sur un fond fin et aérien.',
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
			fr: 'Tissé par les ateliers du Bengale, net à porter et agréable pendant une longue journée humide.',
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
			fr: 'Imprimé à la main au bloc au Rajasthan : les petites différences d’une pièce à l’autre font partie du travail.',
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
			fr: 'Coton biologique teint aux plantes, doux pour la peau et léger à porter.',
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
			fr: 'Coton tissé main du sud de l’Inde, ferme, à bordure contrastée, fait pour le drapé de tous les jours.',
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
			fr: 'Dessiné au calame ou imprimé au bloc en Andhra Pradesh, avec des teintures naturelles et des scènes traditionnelles.',
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
			fr: 'Un mélange de soie à l’allure de la soie pure, à un prix plus doux et facile à entretenir.',
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
			fr: 'Ornements finis à la main sur un tissu fluide, pour accrocher la lumière le soir.',
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
			fr: 'Une pièce simple de tous les jours à prix doux, légère à draper et rapide à laver.',
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
			fr: 'Imprimé dans le détail, avec une couleur qui reste nette après un lavage soigné.',
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
			fr: 'Un ensemble complet avec haut, bas et dupatta, coupé large pour qu’un tailleur l’ajuste à vous.',
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

const leaves = (group: string, family: string, rows: ReadonlyArray<[string, string, number?, Partial<Leaf>?]>): Leaf[] =>
	rows.map(([slug, name, count, extra]) => ({ path: `${group}/${slug}`, name, family, count: count ?? 12, ...extra }));

/** The garments a dress material comes as, so one category shows the range a shop carries. */
export const GARMENTS: readonly Words[] = [
	{ en: 'Salwar Suit', fr: 'Salwar Suit' },
	{ en: 'Anarkali Suit', fr: 'Ensemble Anarkali' },
	{ en: 'Churidar Suit', fr: 'Ensemble Churidar' },
	{ en: 'Patiala Suit', fr: 'Ensemble Patiala' },
	{ en: 'Palazzo Suit', fr: 'Ensemble Palazzo' },
	{ en: 'Sharara Suit', fr: 'Ensemble Sharara' },
	{ en: 'Straight Cut Suit', fr: 'Ensemble coupe droite' },
	{ en: 'Unstitched Suit Material', fr: 'Tissu d’ensemble non cousu' },
	{ en: 'Kurta Dupatta Set', fr: 'Ensemble Kurta et Dupatta' },
	{ en: 'Dress Material', fr: 'Tissu pour robe' },
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
		['georgette', 'Georgette', 12, { noun: { en: 'Pure Georgette Saree', fr: 'Sari en georgette pure' } }],
	]),
	...leaves('sarees/pure-silk', 'banarasi', [['wedding-banarasi', 'Wedding Banarasi', 14]]),
	...leaves('sarees/pure-silk', 'kanchipuram', [['arni', 'Arni']]),
	...leaves('sarees/pure-silk', 'ikkat', [['ikkat', 'Ikkat', 12, { noun: { en: 'Ikkat Silk Saree', fr: 'Sari Ikkat en soie' } }]]),
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
		['georgette', 'Georgette', 12, { noun: { en: 'Party Georgette Saree', fr: 'Sari de soirée en georgette' } }],
		['chiffon', 'Chiffon', 12, { fabric: 'Chiffon' }],
		[
			'sarees-with-ready-blouse',
			'Sarees with Ready Blouse',
			12,
			{ noun: { en: 'Saree with Ready Blouse', fr: 'Sari avec blouse prête' } },
		],
		['embroidered', 'Embroidered', 12, { noun: { en: 'Embroidered Party Saree', fr: 'Sari de soirée brodé' } }],
		['stone-work', 'Stone Work', 12, { noun: { en: 'Stone Work Saree', fr: 'Sari à pierres' } }],
		['tissue', 'Tissue', 12, { fabric: 'Tissue' }],
		['sequins', 'Sequins', 12, { noun: { en: 'Sequin Saree', fr: 'Sari à sequins' } }],
	]),
	...leaves('sarees/budget-range', 'budget', [
		['chanderi', 'Chanderi'],
		['supernet', 'Supernet'],
		['printed-chiffon', 'Printed Chiffon', 12, { fabric: 'Chiffon' }],
		['red-and-white', 'Red & White', 12, { noun: { en: 'Red & White Bengal Saree', fr: 'Sari bengali rouge et blanc' } }],
		['embroidered-sarees', 'Embroidered Sarees', 12, { noun: { en: 'Embroidered Saree', fr: 'Sari brodé' } }],
		['printed-silks', 'Printed Silks', 12, { noun: { en: 'Printed Silk Saree', fr: 'Sari en soie imprimée' } }],
		['silk-kota', 'Silk Kota'],
		['printed-kalamkari', 'Printed Kalamkari'],
	]),
	...leaves('sarees/printed', 'printed', [
		['pure-silk', 'Pure Silk', 12, { noun: { en: 'Printed Pure Silk Saree', fr: 'Sari imprimé en pure soie' } }],
		['tussar', 'Tussar', 12, { noun: { en: 'Printed Tussar Silk Saree', fr: 'Sari imprimé en soie Tussar' }, fabric: 'Tussar' }],
		['chiffon', 'Chiffon', 12, { noun: { en: 'Printed Chiffon Saree', fr: 'Sari imprimé en mousseline' }, fabric: 'Chiffon' }],
		['crepe', 'Crepe', 12, { noun: { en: 'Printed Crepe Saree', fr: 'Sari imprimé en crêpe' }, fabric: 'Crepe' }],
		['printed-tussar', 'Printed Tussar', 12, { fabric: 'Tussar' }],
		['kalamkari', 'Kalamkari', 12, { noun: { en: 'Kalamkari Print Saree', fr: 'Sari imprimé Kalamkari' } }],
		['naksha-e-mughal', 'Naksha-e-Mughal'],
		['kora', 'Kora', 12, { noun: { en: 'Printed Kora Saree', fr: 'Sari Kora imprimé' } }],
		['organza', 'Organza', 12, { noun: { en: 'Printed Organza Saree', fr: 'Sari imprimé en organza' }, fabric: 'Organza' }],
		['banarasi', 'Banarasi', 12, { noun: { en: 'Printed Banarasi Saree', fr: 'Sari Banarasi imprimé' } }],
		['tissue-banarasi', 'Tissue Banarasi', 12, { noun: { en: 'Printed Tissue Banarasi Saree', fr: 'Sari Banarasi imprimé en tissu lamé' }, fabric: 'Tissue' }],
	]),
	...leaves('dress-materials', 'suits', [
		['cotton-chikankari', 'Cotton Chikankari', 40, { noun: { en: 'Cotton Chikankari', fr: 'Chikankari en coton' } }],
		['georgette-chikankari', 'Georgette Chikankari', 40, { noun: { en: 'Georgette Chikankari', fr: 'Chikankari en georgette' }, fabric: 'Georgette' }],
		['printed', 'Printed', 40, { noun: { en: 'Printed Cotton', fr: 'Coton imprimé' } }],
		['banarasi', 'Banarasi', 40, { noun: { en: 'Banarasi Silk', fr: 'Soie Banarasi' }, fabric: 'Silk' }],
		['embroidered', 'Embroidered', 40, { noun: { en: 'Embroidered', fr: 'Brodé' }, fabric: 'Georgette' }],
		['party-wear-suits', 'Party Wear Suits', 40, { noun: { en: 'Party Wear', fr: 'De soirée' }, fabric: 'Georgette' }],
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

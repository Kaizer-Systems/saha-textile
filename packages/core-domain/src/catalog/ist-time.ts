/**
 * India time for shoppers (owner, 2026-11-09): the moment shows as fixed IST text, the same for
 * everyone in the world, and the countdown is a remaining time, which needs no time zone.
 * India keeps +05:30 all year, so this is exact arithmetic on the UTC instant.
 */
const IST_OFFSET_MS = 330 * 60_000;

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_BN = [
	'জানুয়ারি',
	'ফেব্রুয়ারি',
	'মার্চ',
	'এপ্রিল',
	'মে',
	'জুন',
	'জুলাই',
	'আগস্ট',
	'সেপ্টেম্বর',
	'অক্টোবর',
	'নভেম্বর',
	'ডিসেম্বর',
];

/** The Bengali part of the day that goes before a 12-hour time. */
function bengaliDayPart(hour: number): string {
	if (hour >= 4 && hour < 12) return 'সকাল';
	if (hour >= 12 && hour < 16) return 'দুপুর';
	if (hour >= 16 && hour < 18) return 'বিকেল';
	if (hour >= 18 && hour < 20) return 'সন্ধ্যা';
	return 'রাত';
}

/**
 * The fixed India-time text every shopper sees, wherever they are: `27 Sep 2027, 11:59 PM IST`,
 * or in Bengali `27 সেপ্টেম্বর 2027, রাত 11:59 IST` (English digits, per the Bengali rules).
 */
export function formatIst(iso: string, locale: string): string {
	const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
	const day = shifted.getUTCDate();
	const year = shifted.getUTCFullYear();
	const hour = shifted.getUTCHours();
	const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	if (locale === 'bn') {
		return `${day} ${MONTHS_BN[shifted.getUTCMonth()]} ${year}, ${bengaliDayPart(hour)} ${twelve}:${minute} IST`;
	}
	return `${day} ${MONTHS_EN[shifted.getUTCMonth()]} ${year}, ${twelve}:${minute} ${hour < 12 ? 'AM' : 'PM'} IST`;
}

/** Days, hours, minutes and seconds left. Long waits stay in days: months differ in length. */
export function countdownParts(remainingMs: number): { days: number; hours: number; minutes: number; seconds: number } {
	const total = Math.max(0, Math.floor(remainingMs / 1000));
	return {
		days: Math.floor(total / 86_400),
		hours: Math.floor((total % 86_400) / 3_600),
		minutes: Math.floor((total % 3_600) / 60),
		seconds: total % 60,
	};
}

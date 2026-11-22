const ONES = [
	'',
	'One',
	'Two',
	'Three',
	'Four',
	'Five',
	'Six',
	'Seven',
	'Eight',
	'Nine',
	'Ten',
	'Eleven',
	'Twelve',
	'Thirteen',
	'Fourteen',
	'Fifteen',
	'Sixteen',
	'Seventeen',
	'Eighteen',
	'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 in words. */
function belowHundred(n: number): string {
	if (n < 20) return ONES[n] ?? '';
	const ten = TENS[Math.floor(n / 10)] ?? '';
	const one = ONES[n % 10] ?? '';
	return one ? `${ten} ${one}` : ten;
}

/** 0–999 in words. */
function belowThousand(n: number): string {
	const hundred = Math.floor(n / 100);
	const rest = belowHundred(n % 100);
	if (!hundred) return rest;
	return rest ? `${ONES[hundred]} Hundred ${rest}` : `${ONES[hundred]} Hundred`;
}

/** A whole number in the Indian system: crore, lakh, thousand, hundred. */
function indianWords(n: number): string {
	if (n === 0) return 'Zero';
	const parts: string[] = [];
	const crore = Math.floor(n / 10_000_000);
	if (crore) parts.push(`${indianWords(crore)} Crore`);
	const lakh = Math.floor((n % 10_000_000) / 100_000);
	if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
	const thousand = Math.floor((n % 100_000) / 1000);
	if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
	const rest = n % 1000;
	if (rest) parts.push(belowThousand(rest));
	return parts.join(' ');
}

/**
 * An amount in rupees as printed documents write it: "Rupees Ten Thousand Only",
 * "Rupees Fifty Two Thousand Four Hundred Seventy Five and Fifty Paise Only".
 */
export function rupeesInWords(amountINR: number): string {
	const paiseTotal = Math.round(Math.abs(amountINR) * 100);
	const rupees = Math.floor(paiseTotal / 100);
	const paise = paiseTotal % 100;
	const words = `Rupees ${indianWords(rupees)}`;
	return paise ? `${words} and ${belowHundred(paise)} Paise Only` : `${words} Only`;
}

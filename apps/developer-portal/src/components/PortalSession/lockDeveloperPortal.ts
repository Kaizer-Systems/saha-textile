export async function lockDeveloperPortal(): Promise<void> {
	const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	const response = await fetch('/__portal/auth/logout', {
		method: 'POST',
		headers: { 'X-Portal-Request': 'identity-loom' },
	});

	if (!response.ok) throw new Error(`Portal lock returned ${response.status}`);
	window.location.replace(`/__portal/login?next=${encodeURIComponent(returnPath)}`);
}

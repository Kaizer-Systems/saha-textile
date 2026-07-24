// LEGACY prod counterpart — kept only for shape parity. Deploy URLs are NOT
// baked here (no fileReplacements); runtime-config.ts fills real values from
// the per-environment public/config.json at app init (roadmap §0b/0d).

export const environment = {
	production: true,
	apiUrl: 'http://localhost:4000',
	baseURL: 'http://localhost:4200/',
	URL: 'http://localhost:4200/assets/data',
};

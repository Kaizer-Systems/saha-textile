// LEGACY mutable environment object (Fastkart-port shape). Do NOT rely on
// build-time fileReplacements for deploy URLs — per the locked env model
// (roadmap §0b) these values are OVERWRITTEN at app init by
// src/app/core/config/runtime-config.ts from public/config.json.
// Localhost defaults below only cover the instant before that initializer runs.

export const environment = {
	production: false,
	apiUrl: 'https://localhost:4000',
	URL: 'https://localhost:4300/assets/data',
};

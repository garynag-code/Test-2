/**
 * `server-only` throws when imported outside a React Server Component. Tests
 * exercise the server modules directly in Node, so it is aliased to this no-op
 * (the real guard still applies to the application build).
 */
export {};

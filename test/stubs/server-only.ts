/**
 * Test stub for the `server-only` marker package.
 *
 * `server-only`'s real entry point is a bare `throw`. That is the whole
 * mechanism: importing a server module from a client component fails at build
 * time with a clear error. Its package.json maps the `react-server` export
 * condition to an empty module, which is how it stays silent inside an RSC
 * graph.
 *
 * Vitest is neither of those. Without a stand-in, every module marked
 * `server-only` — the DAL, all seven query modules, the throttle store —
 * throws on import and is untestable, which is a large part of why this
 * codebase had no tests outside its pure layers.
 *
 * Pointing the alias at `server-only/empty.js` directly does not work: that
 * file exists but is not listed as a subpath in the package's `exports`, so
 * the resolver refuses it. Hence a stub of our own, which also does not
 * depend on the internals of a package we do not control.
 */
export {}

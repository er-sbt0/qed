/**
 * vitest.workspace.ts — one vitest, six projects.
 *
 * `pnpm -r test` booted a separate vitest per package, and the tests are not
 * what costs anything: ~1.2s of actual execution sat under ~3.5s of six cold
 * starts each paying its own transform + collect. A workspace pays that once.
 *
 * Each project still resolves its OWN vitest.config.ts, which matters — the
 * library project's `./api` resolver is importer-path-dependent and must not
 * leak into the other projects.
 */
export default ['packages/*'];

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // zkd-shared is the narrow PLAN/EXECUTE boundary contract package (types,
  // idempotency, the OPA client, halt conditions) — consumed as TS source
  // via a local `file:` dependency, never built separately.
  //
  // package.json pins `next build`/`next dev` to --webpack: Next 16's
  // Turbopack (the new default) fails to resolve this symlinked `file:`
  // package at all ("Module not found: Can't resolve 'zkd-shared'") even
  // with transpilePackages set; plain webpack resolves it correctly. Revisit
  // dropping --webpack once Turbopack's monorepo/symlink resolution matures.
  transpilePackages: ['zkd-shared'],
};

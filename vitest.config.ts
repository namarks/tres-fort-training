import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(here, 'migrations'));
  return {
    test: {
      // Only run this repo's own tests. Without an explicit include, vitest's
      // default glob descends into agent worktrees under .claude/worktrees/
      // and runs their stale snapshots.
      include: ['test/**/*.test.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          // Already the default; pinned because the suites rely on it: a
          // describe-level beforeAll seed stays visible to every `it` in the
          // block while each `it`'s own writes are rolled back, which is what
          // makes the exact per-case audit/note counts hold.
          isolatedStorage: true,
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              APP_JWT_SECRET: 'test-secret',
              CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
              MCP_STATIC_TOKEN: 'test-mcp-token',
              DIAGNOSTICS_TOKEN: 'test-diagnostics-token-0123456789abcdef',
              DEV_AUTH_SECRET: 'test-dev',
              OWNER_AUTH_PASSPHRASE: 'test-pass',
              APPLE_BUNDLE_ID: 'com.example.tresfort',
              // intervals.icu cycling-awareness: test values so the feature
              // is "enabled" in tests, but the fetcher is always injected/
              // stubbed — the suite makes ZERO real network calls.
              INTERVALS_ICU_API_KEY: 'test-intervals-key',
              INTERVALS_ICU_ATHLETE_ID: 'i12345',
              // intervals.icu OAuth: test values so the /auth/intervals/start
              // route is "configured" in tests. The /callback token exchange
              // hits the network, so callback tests assert only the offline
              // paths (bad/missing state, error param) — never the live POST.
              INTERVALS_OAUTH_CLIENT_ID: '431',
              INTERVALS_OAUTH_CLIENT_SECRET: 'test-oauth-secret',
              // intervals.icu push webhook (POST /webhooks/intervals): a test
              // value so the receiver is "configured" and secret-matching can
              // be exercised. The triggered syncs no-op gracefully in tests
              // (the reconciled-cache fetch is the injected/dormant path).
              INTERVALS_WEBHOOK_SECRET: 'test-webhook-secret',
              // WHOOP (docs/plans/whoop): configured so its routes run; every
              // WHOOP request in the suite is answered by fetchMock.
              WHOOP_CLIENT_ID: 'test-whoop-client',
              WHOOP_CLIENT_SECRET: 'test-whoop-secret',
              // Garmin (docs/plans/garmin): configured so its routes run; every
              // Garmin request in the suite is answered by fetchMock.
              GARMIN_CLIENT_ID: 'test-garmin-client',
              GARMIN_CLIENT_SECRET: 'test-garmin-secret',
              GARMIN_PUSH_SECRET: 'test-garmin-push-secret-0123456789abcdef',
              // Standing connect code for the synthetic directory-review
              // member; test/review_connect_code.test.ts creates that user.
              REVIEW_CONNECT_CODE: 'test-review-code-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              REVIEW_USER_ID: 'directory-review-member',
            },
          },
        },
      },
    },
  };
});

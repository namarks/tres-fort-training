declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    APP_JWT_SECRET: string;
    CREDENTIAL_ENCRYPTION_KEY: string;
    MCP_STATIC_TOKEN: string;
    DEV_AUTH_SECRET: string;
    OWNER_AUTH_PASSPHRASE: string;
    APPLE_BUNDLE_ID: string;
    APPLE_TEAM_ID?: string;
    APPLE_KEY_ID?: string;
    APPLE_PRIVATE_KEY?: string;
    OWNER_APPLE_SUB?: string;
    /** Unset in the suite; test/openai_apps_challenge.test.ts supplies it per request. */
    OPENAI_APPS_CHALLENGE?: string;
    /** intervals.icu key — wired in vitest.config.ts so tests are not dormant. */
    INTERVALS_ICU_API_KEY?: string;
    /** intervals.icu athlete id — paired with INTERVALS_ICU_API_KEY in tests. */
    INTERVALS_ICU_ATHLETE_ID?: string;
    /** Garmin test values, wired in vitest.config.ts (docs/plans/garmin). */
    GARMIN_CLIENT_ID?: string;
    GARMIN_CLIENT_SECRET?: string;
    GARMIN_PUSH_SECRET?: string;
  }
}

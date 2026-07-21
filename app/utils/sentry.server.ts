import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

/**
 * Reports an error to Sentry if SENTRY_DSN is configured; otherwise just
 * logs it, so this is always safe to call regardless of environment.
 * Inert (no-op beyond the log) until a real DSN is set -- see the
 * deployment-hardening issue in GITHUB_ISSUES.md.
 */
export function captureException(error: unknown, context?: Record<string, unknown>) {
  console.error(error, context);
  if (dsn) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  }
}

if (dsn) {
  process.on("uncaughtException", (error) => {
    captureException(error, { source: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    captureException(reason, { source: "unhandledRejection" });
  });
}

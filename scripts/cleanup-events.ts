/**
 * Deletes Event rows older than the given retention window. There's no
 * in-app job runner, so this needs to be invoked by an external
 * scheduler (cron, a platform's scheduled-task feature, etc.) -- e.g.
 * `npm run cleanup-events -- --days 90` on a daily cron.
 */
import { pruneEventsOlderThan } from "../app/models/event.server";

function parseDays(argv: string[]): number {
  const flagIndex = argv.indexOf("--days");
  const value = flagIndex >= 0 ? Number(argv[flagIndex + 1]) : 90;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --days value: ${argv[flagIndex + 1]}`);
  }
  return value;
}

async function main() {
  const days = parseDays(process.argv.slice(2));
  const result = await pruneEventsOlderThan(days);
  console.log(`Deleted ${result.count} event(s) older than ${days} day(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

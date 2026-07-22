/**
 * Load-tests the two hot paths behind the App Proxy against a real
 * database: getActiveExperimentForTarget (the read path, hit on every
 * storefront page load) and recordEvent (the write path, hit on every
 * impression/add-to-cart). Deliberately skips HTTP and App Proxy HMAC
 * signature verification -- that layer is fast/cheap and not the actual
 * bottleneck; the database is. Run with a real Postgres running
 * (`docker compose up -d`) to get meaningful numbers.
 *
 * Usage: npm run load-test -- --concurrency 50 --requests 2000
 */
import { performance } from "node:perf_hooks";
import prisma from "../app/db.server";
import { createExperiment, getActiveExperimentForTarget, transitionExperimentStatus } from "../app/models/experiment.server";
import { createVariant } from "../app/models/variant.server";
import { recordEvent } from "../app/models/event.server";

interface Args {
  concurrency: number;
  requests: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  return {
    concurrency: get("--concurrency", 50),
    requests: get("--requests", 2000),
  };
}

interface RunResult {
  label: string;
  latenciesMs: number[];
  errors: number;
  totalMs: number;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function report(result: RunResult, totalRequests: number) {
  const sorted = [...result.latenciesMs].sort((a, b) => a - b);
  const throughput = (totalRequests / result.totalMs) * 1000;
  console.log(`\n-- ${result.label} --`);
  console.log(`  requests: ${totalRequests}, errors: ${result.errors}`);
  console.log(`  throughput: ${throughput.toFixed(1)} req/s`);
  console.log(`  latency p50: ${percentile(sorted, 50).toFixed(1)}ms`);
  console.log(`  latency p95: ${percentile(sorted, 95).toFixed(1)}ms`);
  console.log(`  latency p99: ${percentile(sorted, 99).toFixed(1)}ms`);
  console.log(`  latency max: ${sorted[sorted.length - 1]?.toFixed(1)}ms`);
}

async function runConcurrent(
  label: string,
  totalRequests: number,
  concurrency: number,
  task: (i: number) => Promise<void>,
): Promise<RunResult> {
  const latenciesMs: number[] = [];
  let errors = 0;
  const start = performance.now();

  let next = 0;
  async function worker() {
    while (next < totalRequests) {
      const i = next++;
      const requestStart = performance.now();
      try {
        await task(i);
      } catch {
        errors++;
      }
      latenciesMs.push(performance.now() - requestStart);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalMs = performance.now() - start;
  return { label, latenciesMs, errors, totalMs };
}

async function main() {
  const { concurrency, requests } = parseArgs(process.argv.slice(2));
  console.log(`Load test: ${requests} requests at concurrency ${concurrency}`);

  const domain = `load-test-${Date.now()}.myshopify.com`;
  const shop = await prisma.shop.create({ data: { domain } });

  const experiment = await createExperiment(shop.id, {
    name: "Load test experiment",
    targetType: "PRODUCT_PAGE",
    goal: "ADD_TO_CART",
  });
  const control = await createVariant(shop.id, experiment.id, {
    name: "Control",
    isControl: true,
    weight: 50,
    content: JSON.stringify({ text: "Add to cart" }),
  });
  await createVariant(shop.id, experiment.id, {
    name: "B",
    isControl: false,
    weight: 50,
    content: JSON.stringify({ text: "Buy now" }),
  });
  await transitionExperimentStatus(shop.id, experiment.id, "RUNNING");

  try {
    const readResult = await runConcurrent("read: getActiveExperimentForTarget", requests, concurrency, async () => {
      await getActiveExperimentForTarget(shop.id, "PRODUCT_PAGE", null);
    });
    report(readResult, requests);

    const writeResult = await runConcurrent("write: recordEvent (IMPRESSION)", requests, concurrency, async (i) => {
      await recordEvent(shop.id, {
        experimentId: experiment.id,
        variantId: control.id,
        visitorId: `load-test-visitor-${i}`,
        type: "IMPRESSION",
      });
    });
    report(writeResult, requests);
  } finally {
    await prisma.shop.delete({ where: { id: shop.id } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

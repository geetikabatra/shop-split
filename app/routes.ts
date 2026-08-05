import { flatRoutes } from "@react-router/fs-routes";

// ignoredRouteFiles defaults to [] -- without this, colocated test files
// like webhooks.orders.paid.test.ts get swept into the route tree and
// bundled into the server build. Those call vi.mock() at module scope,
// which throws ("Vitest mocker was not initialized") the moment the real
// dev/production server (not vitest) evaluates the module.
export default flatRoutes({
  ignoredRouteFiles: ["**/*.test.ts", "**/*.test.tsx"],
});

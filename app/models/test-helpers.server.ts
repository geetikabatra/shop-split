import prisma from "../db.server";

/** Creates a throwaway shop for a test; caller should call cleanupShop() in afterEach. */
export async function createTestShop() {
  const domain = `test-${Math.random().toString(36).slice(2)}.myshopify.com`;
  return prisma.shop.create({ data: { domain } });
}

export async function cleanupShop(shopId: string) {
  await prisma.shop.delete({ where: { id: shopId } });
}

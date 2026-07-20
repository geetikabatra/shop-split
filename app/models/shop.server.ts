import prisma from "../db.server";

export async function getOrCreateShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    update: {},
    create: { domain },
  });
}

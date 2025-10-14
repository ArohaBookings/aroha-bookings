import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "aroha-salon" },
    update: {},
    create: { name: "Aroha Salon", slug: "aroha-salon", timezone: "Pacific/Auckland" },
  });

  const staff = await prisma.staffMember.createMany({
    data: [
      { orgId: org.id, name: "Ruby", email: "ruby@aroha.nz", colorHex: "#FF6B6B" },
      { orgId: org.id, name: "Jo", email: "jo@aroha.nz", colorHex: "#6BCB77" },
      { orgId: org.id, name: "Sarah", email: "sarah@aroha.nz", colorHex: "#4D96FF" },
    ],
  });

  const services = await prisma.service.createMany({
    data: [
      { orgId: org.id, name: "Women's Cut", durationMin: 45, priceCents: 9500 },
      { orgId: org.id, name: "Men's Fade", durationMin: 30, priceCents: 5500 },
      { orgId: org.id, name: "Color & Tone", durationMin: 60, priceCents: 12000 },
    ],
  });

  console.log("✅ Seed complete: Aroha Salon demo data created.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
  
/**
 * DEV-ONLY demo data (planning Phase 10): two organizations, teams with Leads,
 * public categories, internal tickets, portal complaints, sub-tickets.
 *
 *   npm run seed
 *
 * Refuses to run when NODE_ENV=production, and does nothing if the demo
 * organizations already exist. Every account uses the password below.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hashPassword } from '../src/shared/crypto.js';

export const DEMO_PASSWORD = 'Password123!';

const prisma = new PrismaClient();

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV is "production". The seed is for local development only.');
    process.exit(1);
  }
  if (await prisma.organization.findUnique({ where: { slug: 'city-college' } })) {
    console.log('Demo data already exists (city-college). Nothing to do.');
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash, emailVerifiedAt: new Date() } });

  // ---------- people ----------
  const admin = await user('admin@city.test', 'Anita Admin');
  const manager = await user('manager@city.test', 'Manoj Manager');
  const itLead = await user('itlead@city.test', 'Lina Lead');
  const it1 = await user('it1@city.test', 'Ravi Tech');
  const it2 = await user('it2@city.test', 'Sara Tech');
  const hostelLead = await user('hostel@city.test', 'Harish Hostel');
  const student = await user('student@city.test', 'Sam Student');
  const shopAdmin = await user('admin@shop.test', 'Omar Owner');
  const shopAgent = await user('support@shop.test', 'Priya Support');
  const customer = await user('customer@shop.test', 'Chris Customer');

  // ---------- City College ----------
  const city = await prisma.organization.create({
    data: {
      name: 'City College',
      slug: 'city-college',
      portalEnabled: true,
      portalIntro: 'Students: report problems with Wi-Fi, hostel rooms and campus facilities here.',
    },
  });
  const m = async (userId: string, role: 'ADMIN' | 'MANAGER' | 'STAFF', orgId = city.id) =>
    prisma.membership.create({ data: { organizationId: orgId, userId, role } });
  const mAdmin = await m(admin.id, 'ADMIN');
  const mManager = await m(manager.id, 'MANAGER');
  const mLead = await m(itLead.id, 'STAFF');
  const mIt1 = await m(it1.id, 'STAFF');
  const mIt2 = await m(it2.id, 'STAFF');
  const mHostel = await m(hostelLead.id, 'STAFF');

  const team = (orgId: string, name: string) =>
    prisma.team.create({ data: { organizationId: orgId, name, nameKey: name.toLowerCase() } });
  const it = await team(city.id, 'IT');
  const hostel = await team(city.id, 'Hostel');
  await prisma.teamMember.createMany({
    data: [
      { organizationId: city.id, teamId: it.id, membershipId: mLead.id, isLead: true },
      { organizationId: city.id, teamId: it.id, membershipId: mIt1.id },
      { organizationId: city.id, teamId: it.id, membershipId: mIt2.id },
      { organizationId: city.id, teamId: hostel.id, membershipId: mHostel.id, isLead: true },
    ],
  });

  const category = (orgId: string, name: string, isPublic: boolean, defaultTeamId: string | null) =>
    prisma.category.create({
      data: { organizationId: orgId, name, nameKey: name.toLowerCase(), isPublic, defaultTeamId },
    });
  const wifi = await category(city.id, 'Wi-Fi', true, it.id);
  const room = await category(city.id, 'Hostel room', true, hostel.id);
  const lab = await category(city.id, 'Lab equipment', false, it.id);

  /** Ticket with the next number + a CREATED activity (like the real services do). */
  const ticket = async (
    orgId: string,
    actorUserId: string | null,
    data: Omit<Prisma.TicketUncheckedCreateInput, 'organizationId' | 'number'>
  ) => {
    const org = await prisma.organization.update({ where: { id: orgId }, data: { ticketCounter: { increment: 1 } } });
    const t = await prisma.ticket.create({ data: { organizationId: orgId, number: org.ticketCounter, ...data } });
    await prisma.ticketActivity.create({
      data: { organizationId: orgId, ticketId: t.id, actorUserId, type: 'CREATED', toValue: `T-${t.number}` },
    });
    return t;
  };
  const day = 24 * 60 * 60 * 1000;

  // Top-down: a Manager's ticket split by the IT Lead into two sub-tickets.
  const migrate = await ticket(city.id, manager.id, {
    source: 'INTERNAL',
    subject: 'Upgrade the Block C network',
    description: 'Students report slow Wi-Fi in Block C. Replace the old switch and update the router firmware.',
    priority: 'HIGH',
    teamId: it.id,
    assigneeId: mLead.id,
    createdByMembershipId: mManager.id,
    status: 'IN_PROGRESS',
    dueDate: new Date(Date.now() + 5 * day),
    categoryId: lab.id,
  });
  await ticket(city.id, itLead.id, {
    source: 'INTERNAL',
    subject: 'Replace the Block C switch',
    description: 'Swap the 24-port switch in the Block C cabinet.',
    teamId: it.id,
    assigneeId: mIt1.id,
    createdByMembershipId: mLead.id,
    parentId: migrate.id,
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  await ticket(city.id, itLead.id, {
    source: 'INTERNAL',
    subject: 'Update router firmware',
    description: 'Update the firmware of both Block C routers.',
    teamId: it.id,
    assigneeId: mIt2.id,
    createdByMembershipId: mLead.id,
    parentId: migrate.id,
  });

  // Bottom-up: student complaints in several states.
  const complaint = await ticket(city.id, student.id, {
    source: 'PORTAL',
    subject: 'No Wi-Fi in room 104',
    description: 'Since Monday my laptop cannot connect to the campus Wi-Fi in room 104 of Block C.',
    teamId: it.id,
    categoryId: wifi.id,
    requesterId: student.id,
    assigneeId: mIt1.id,
    status: 'WAITING_ON_REQUESTER',
  });
  await prisma.comment.createMany({
    data: [
      {
        organizationId: city.id,
        ticketId: complaint.id,
        authorUserId: it1.id,
        authorType: 'STAFF',
        visibility: 'INTERNAL',
        body: 'Probably the Block C switch - see T-1.',
      },
      {
        organizationId: city.id,
        ticketId: complaint.id,
        authorUserId: it1.id,
        authorType: 'STAFF',
        visibility: 'PUBLIC',
        body: 'Thanks for reporting. Does it happen on your phone too?',
      },
    ],
  });
  await ticket(city.id, student.id, {
    source: 'PORTAL',
    subject: 'Broken window latch',
    description: 'The window in hostel room 12 does not close any more.',
    teamId: hostel.id,
    categoryId: room.id,
    requesterId: student.id,
  });
  await ticket(city.id, student.id, {
    source: 'PORTAL',
    subject: 'Printer in the library is offline',
    description: 'The library printer shows "offline" for everyone.',
    teamId: it.id,
    categoryId: wifi.id,
    requesterId: student.id,
    assigneeId: mIt2.id,
    status: 'RESOLVED',
    resolvedAt: new Date(Date.now() - 2 * day),
  });
  // Unrouted: waits in the Unassigned queue for Managers.
  await ticket(city.id, admin.id, {
    source: 'INTERNAL',
    subject: 'Order new projector bulbs',
    description: 'Three lecture halls need projector bulbs before the exams.',
    createdByMembershipId: mAdmin.id,
    dueDate: new Date(Date.now() - 2 * day), // overdue
  });

  // ---------- Acme Shop (a second, completely separate organization) ----------
  const shop = await prisma.organization.create({
    data: { name: 'Acme Shop', slug: 'acme-shop', portalEnabled: true },
  });
  await m(shopAdmin.id, 'ADMIN', shop.id);
  const mAgent = await m(shopAgent.id, 'STAFF', shop.id);
  const support = await team(shop.id, 'Support');
  await prisma.teamMember.create({
    data: { organizationId: shop.id, teamId: support.id, membershipId: mAgent.id, isLead: true },
  });
  const refund = await category(shop.id, 'Refund', true, support.id);
  await ticket(shop.id, customer.id, {
    source: 'PORTAL',
    subject: 'Refund for order 1042',
    description: 'The blender arrived broken. I would like a refund please.',
    teamId: support.id,
    categoryId: refund.id,
    requesterId: customer.id,
  });

  console.log(`Demo data created. Every account's password: ${DEMO_PASSWORD}
  City College (/w/city-college, portal /o/city-college):
    admin@city.test (Admin), manager@city.test (Manager), itlead@city.test (IT Lead),
    it1@city.test, it2@city.test (IT staff), hostel@city.test (Hostel Lead), student@city.test (requester)
  Acme Shop (/w/acme-shop, portal /o/acme-shop):
    admin@shop.test (Admin), support@shop.test (Support Lead), customer@shop.test (requester)`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

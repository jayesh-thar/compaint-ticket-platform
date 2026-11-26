import { describe, it, expect } from 'vitest';
import {
  type Actor,
  type TicketRef,
  canManageOrganization,
  canViewTicket,
  checkCreateTicket,
  canCreateSubticket,
  canAssign,
  canTakeTicket,
  canChangeTeam,
  canEditTriageFields,
  canEditText,
  canChangeWorkingStatus,
  canCloseTicket,
  canReopenClosed,
  canComment,
} from '../src/shared/permissions.js';

// One organization, two teams (IT, HOSTEL). The matrix is README section 5.3.
const IT = 'team-it';
const HOSTEL = 'team-hostel';

const actor = (
  role: Actor['role'],
  membershipId: string,
  teamIds: string[] = [],
  leadTeamIds: string[] = []
): Actor => ({
  userId: `u-${membershipId}`,
  organizationId: 'org',
  membershipId,
  role,
  teamIds,
  leadTeamIds,
});

const admin = actor('ADMIN', 'admin');
const manager = actor('MANAGER', 'manager');
const itLead = actor('STAFF', 'it-lead', [IT], [IT]);
const itStaff = actor('STAFF', 'it-staff', [IT]);
const hostelStaff = actor('STAFF', 'hostel-staff', [HOSTEL]);
const loner = actor('STAFF', 'loner'); // staff in no team

const ticket = (over: Partial<TicketRef> = {}): TicketRef => ({
  teamId: IT,
  assigneeId: null,
  createdByMembershipId: 'manager',
  parentId: null,
  ...over,
});

describe('permission matrix (README 5.3)', () => {
  it('settings / members / teams / categories: Admin only', () => {
    expect(canManageOrganization(admin)).toBe(true);
    for (const a of [manager, itLead, itStaff]) expect(canManageOrganization(a)).toBe(false);
  });

  describe('view tickets', () => {
    it('Admin and Manager see everything', () => {
      expect(canViewTicket(admin, ticket({ teamId: HOSTEL }))).toBe(true);
      expect(canViewTicket(manager, ticket({ teamId: null }))).toBe(true);
    });
    it('Lead and Staff see own team, assigned, and created', () => {
      expect(canViewTicket(itStaff, ticket())).toBe(true); // own team
      expect(canViewTicket(itLead, ticket())).toBe(true);
      expect(canViewTicket(hostelStaff, ticket())).toBe(false); // other team
      expect(canViewTicket(hostelStaff, ticket({ assigneeId: 'hostel-staff' }))).toBe(true); // assigned
      expect(canViewTicket(loner, ticket({ teamId: null, createdByMembershipId: 'loner' }))).toBe(true); // created
      expect(canViewTicket(loner, ticket({ teamId: null }))).toBe(false);
    });
  });

  describe('create internal ticket', () => {
    it('Admin/Manager: any team, any assignee, or no team', () => {
      expect(checkCreateTicket(admin, { teamId: HOSTEL, assigneeId: 'x' }).ok).toBe(true);
      expect(checkCreateTicket(manager, { teamId: null, assigneeId: null }).ok).toBe(true);
    });
    it('Lead: own team with any assignee; not another team', () => {
      expect(checkCreateTicket(itLead, { teamId: IT, assigneeId: 'it-staff' }).ok).toBe(true);
      expect(checkCreateTicket(itLead, { teamId: HOSTEL, assigneeId: null })).toEqual({
        ok: false,
        reason: 'NOT_OWN_TEAM',
      });
    });
    it('Staff: own team, unassigned or self only; team required', () => {
      expect(checkCreateTicket(itStaff, { teamId: IT, assigneeId: null }).ok).toBe(true);
      expect(checkCreateTicket(itStaff, { teamId: IT, assigneeId: 'it-staff' }).ok).toBe(true);
      expect(checkCreateTicket(itStaff, { teamId: IT, assigneeId: 'it-lead' })).toEqual({
        ok: false,
        reason: 'SELF_ASSIGN_ONLY',
      });
      expect(checkCreateTicket(itStaff, { teamId: HOSTEL, assigneeId: null })).toEqual({
        ok: false,
        reason: 'NOT_OWN_TEAM',
      });
      expect(checkCreateTicket(itStaff, { teamId: null, assigneeId: null })).toEqual({
        ok: false,
        reason: 'TEAM_REQUIRED',
      });
    });
  });

  it('create sub-ticket: Admin/Manager any; Lead only for parent in own team; Staff never', () => {
    expect(canCreateSubticket(admin, ticket({ teamId: HOSTEL }))).toBe(true);
    expect(canCreateSubticket(manager, ticket())).toBe(true);
    expect(canCreateSubticket(itLead, ticket())).toBe(true);
    expect(canCreateSubticket(itLead, ticket({ teamId: HOSTEL }))).toBe(false);
    expect(canCreateSubticket(itStaff, ticket())).toBe(false);
  });

  describe('assign / reassign / unassign', () => {
    it('Admin/Manager: anyone, or unassign', () => {
      expect(canAssign(manager, ticket(), { membershipId: 'hostel-staff', inTicketTeam: false })).toBe(true);
      expect(canAssign(admin, ticket({ assigneeId: 'x' }), { membershipId: null, inTicketTeam: false })).toBe(true);
    });
    it('Lead: members of own team, or unassign; nothing for other teams', () => {
      expect(canAssign(itLead, ticket(), { membershipId: 'it-staff', inTicketTeam: true })).toBe(true);
      expect(canAssign(itLead, ticket(), { membershipId: 'hostel-staff', inTicketTeam: false })).toBe(false);
      expect(canAssign(itLead, ticket({ assigneeId: 'it-staff' }), { membershipId: null, inTicketTeam: false })).toBe(
        true
      );
      expect(canAssign(itLead, ticket({ teamId: HOSTEL }), { membershipId: 'it-lead', inTicketTeam: false })).toBe(
        false
      );
    });
    it('Staff: only take an unassigned ticket of own team', () => {
      expect(canAssign(itStaff, ticket(), { membershipId: 'it-staff', inTicketTeam: true })).toBe(true);
      expect(
        canAssign(itStaff, ticket({ assigneeId: 'it-lead' }), { membershipId: 'it-staff', inTicketTeam: true })
      ).toBe(false);
      expect(canAssign(itStaff, ticket(), { membershipId: 'it-lead', inTicketTeam: true })).toBe(false);
      expect(canAssign(itStaff, ticket(), { membershipId: null, inTicketTeam: false })).toBe(false);
      expect(canAssign(hostelStaff, ticket(), { membershipId: 'hostel-staff', inTicketTeam: false })).toBe(false);
    });
    it('"Take it" button follows the same rule', () => {
      expect(canTakeTicket(itStaff, ticket())).toBe(true);
      expect(canTakeTicket(itStaff, ticket({ assigneeId: 'x' }))).toBe(false);
      expect(canTakeTicket(hostelStaff, ticket())).toBe(false);
      expect(canTakeTicket(manager, ticket({ teamId: null }))).toBe(true);
    });
  });

  it('change team: Admin/Manager only', () => {
    expect(canChangeTeam(admin)).toBe(true);
    expect(canChangeTeam(manager)).toBe(true);
    expect(canChangeTeam(itLead)).toBe(false);
    expect(canChangeTeam(itStaff)).toBe(false);
  });

  it('priority / due date / category: Admin, Manager, Lead of own team', () => {
    expect(canEditTriageFields(admin, ticket())).toBe(true);
    expect(canEditTriageFields(manager, ticket())).toBe(true);
    expect(canEditTriageFields(itLead, ticket())).toBe(true);
    expect(canEditTriageFields(itLead, ticket({ teamId: HOSTEL }))).toBe(false);
    expect(canEditTriageFields(itStaff, ticket({ assigneeId: 'it-staff' }))).toBe(false);
  });

  it('subject / description: Admin and Manager only', () => {
    expect(canEditText(admin)).toBe(true);
    expect(canEditText(manager)).toBe(true);
    expect(canEditText(itLead)).toBe(false);
  });

  it('working status: Admin, Manager, Lead of own team, Staff only as assignee', () => {
    expect(canChangeWorkingStatus(manager, ticket())).toBe(true);
    expect(canChangeWorkingStatus(itLead, ticket())).toBe(true);
    expect(canChangeWorkingStatus(itStaff, ticket())).toBe(false);
    expect(canChangeWorkingStatus(itStaff, ticket({ assigneeId: 'it-staff' }))).toBe(true);
    expect(canChangeWorkingStatus(hostelStaff, ticket({ assigneeId: 'hostel-staff' }))).toBe(true);
  });

  it('close: Admin, Manager, Lead of own team; never Staff', () => {
    expect(canCloseTicket(admin, ticket())).toBe(true);
    expect(canCloseTicket(itLead, ticket())).toBe(true);
    expect(canCloseTicket(itLead, ticket({ teamId: HOSTEL }))).toBe(false);
    expect(canCloseTicket(itStaff, ticket({ assigneeId: 'it-staff' }))).toBe(false);
  });

  it('reopen a CLOSED ticket: Admin and Manager only', () => {
    expect(canReopenClosed(admin)).toBe(true);
    expect(canReopenClosed(manager)).toBe(true);
    expect(canReopenClosed(itLead)).toBe(false);
  });

  it('comment: anyone who can see the ticket', () => {
    expect(canComment(itStaff, ticket())).toBe(true);
    expect(canComment(hostelStaff, ticket())).toBe(false);
  });
});

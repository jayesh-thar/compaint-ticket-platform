# Complaint and Ticket Management Portal

A multi-organization platform where work arrives from two directions:
managers create internal tickets and assign them downward, and customers or
students submit complaints upward. Both land in **one ticket system** with one
lifecycle, one assignment model, one conversation history, and one dashboard.

> **Project status:** Phases 0-10 are built and tested locally: accounts,
> organizations and invitations, teams and categories, internal tickets with
> sub-tickets, the status workflow, comments with the email outbox, the
> complaint portal and "My complaints", the dashboard, auto-close, and a
> hardening pass (tenant-isolation suite, rate limits, log redaction, lint).
> Not done yet: deployment (Phase 11) and Docker/CI (Phase 12).
> Progress is tracked in [`planning.md`](planning.md); demo steps in
> [`docs/demo-script.md`](docs/demo-script.md); trade-offs in
> [`docs/known-limitations.md`](docs/known-limitations.md).

**How the three documents fit together**

| File | Answers | Read it for |
| --- | --- | --- |
| `README.md` (this file) | **What** are we building and what are the rules? | Roles, flows, ticket rules, edge cases, scope |
| [`architecture.md`](architecture.md) | **How** is it built? | Components, data model, API, auth, email, deployment, diagrams |
| [`planning.md`](planning.md) | **When** and in what order? | Phases, tasks, tests, acceptance criteria |

If two documents disagree, the order of authority is: README (rules) →
architecture (design) → planning (order of work). Fix the disagreement in the
same change; do not silently pick one.

---

## Table of contents

1. [Overview](#1-overview)
2. [Real-world inspiration](#2-real-world-inspiration)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Core terminology](#4-core-terminology)
5. [Roles, visibility, and permissions](#5-roles-visibility-and-permissions)
6. [The two flows](#6-the-two-flows)
7. [Ticket rules](#7-ticket-rules)
8. [Organizations, members, and accounts](#8-organizations-members-and-accounts)
9. [Email notifications](#9-email-notifications)
10. [Edge cases and expected handling](#10-edge-cases-and-expected-handling)
11. [Technology stack](#11-technology-stack)
12. [Repository structure](#12-repository-structure)
13. [Environment configuration](#13-environment-configuration)
14. [Local development (Windows / PowerShell)](#14-local-development-windows--powershell)
15. [Testing strategy](#15-testing-strategy)
16. [Deployment](#16-deployment)
17. [Scope: MVP, cut list, later](#17-scope-mvp-cut-list-later)
18. [Decision log](#18-decision-log)
19. [Success criteria](#19-success-criteria)

---

## 1. Overview

```text
 Internal ticket  (top -> down)          Portal complaint  (bottom -> up)
 Admin / Manager / Team Lead creates     A customer or student (logged in)
 a ticket and assigns it                 submits a complaint to an organization
               \                                   /
                v                                 v
              ONE TICKET ENGINE
   same table - same statuses - same assignment - same comments - same dashboard
                              |
     Manager / Lead triages, assigns, and can split work into sub-tickets
                              |
     Staff work it:   OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED
```

Examples:

- **University:** students complain about hostel, accounts, or IT. Hostel and
  IT are teams; each team has a Lead. A complaint about "Wi-Fi in Block C" goes
  to the IT team; the Lead splits it into "check router" and "replace switch"
  and assigns each to a technician.
- **E-commerce shop:** customers complain about delivery or payments. Support
  and Logistics are teams.
- **Company:** a manager creates "Migrate staging DB", assigns it to the
  Engineering team; the Lead breaks it into sub-tickets for three developers.

The product is **multi-tenant**: many organizations share one app and one
database; each organization's data is private to it.

## 2. Real-world inspiration

We borrow proven ideas from existing products and keep only what a solo
major project can finish and finish *well*.

| Similar to | Idea we borrow | What we deliberately skip |
| --- | --- | --- |
| Jira | Tickets with assignee, priority, due date, one level of sub-tasks, status flow, "My work" | Boards, sprints, custom workflows, plugins |
| Zendesk / Freshdesk | Organization portal, groups (our **Teams**) with agents, public reply vs internal note, solved -> closed with auto-close | SLAs, macros, email/phone/chat channels, anonymous tickets |
| ServiceNow / ITIL | Category-based routing to a responsible group, triage queue | ITIL process modules |
| College grievance / e-commerce complaint desks | Login to submit, reference number, track status, reply | Public feeds, voting, rating systems |

## 3. Goals and non-goals

### Goals

- Verified users can create an organization and become its Admin.
- Admins manage members, **teams**, team Leads, and complaint categories.
- Managers and Leads create tickets, assign them, and split them into
  sub-tickets (top-down).
- Customers or students submit complaints through an organization portal and
  track them (bottom-up).
- Staff and requesters talk to each other; **internal notes never reach the
  requester**.
- Every ticket change is recorded in an activity timeline.
- Dashboard numbers always match ticket lists.
- Data of one organization is never visible to another.

### Non-goals (MVP)

Microservices, real-time/WebSockets, SLA timers, custom workflows or fields,
attachments, anonymous (no-login) complaints, platform-level super admin,
audit-log screens, inbound email replies, AI features, mobile apps, multiple
languages, reports/exports. See [section 17](#17-scope-mvp-cut-list-later).

## 4. Core terminology

| Term | Meaning |
| --- | --- |
| Organization | A college, shop, or company. The tenant boundary. |
| Workspace | The private area where an organization's members work (`/w/{slug}`). |
| Portal | The organization's public page (`/o/{slug}`) where requesters submit complaints. |
| Member | A user with an active membership in an organization. |
| Role | `ADMIN`, `MANAGER`, or `STAFF` - stored on the **membership**, per organization. |
| Team | A group inside an organization (IT, Hostel, Accounts, Support). Tickets are routed to teams. A team is the only grouping concept; "department" = team. |
| Team Lead | A team member flagged `isLead`. A flag per team, **not** an organization role. Gains manage powers over that team's tickets. |
| Category | A type of complaint ("Wi-Fi", "Refund"). Can be public (shown on portal) or internal-only; may route to a default team. |
| Requester | A registered user who raised a complaint. Not a member; sees only their own tickets. |
| Ticket | The central record. `source` is `INTERNAL` (top-down) or `PORTAL` (bottom-up). |
| Sub-ticket | A ticket with a `parentId`. One level deep only. |
| Public reply | A comment visible to the requester and to members who can see the ticket. |
| Internal note | A comment visible only to members who can see the ticket. |
| Activity | An immutable timeline entry for a ticket change. |
| Triage | Reviewing unassigned tickets: route to a team, assign to a person, or reject. |

## 5. Roles, visibility, and permissions

### 5.1 Roles

| Role | Purpose |
| --- | --- |
| `ADMIN` | Runs the organization: settings, portal, members, teams, categories. Full ticket access. The creator is the first Admin; there can be several. |
| `MANAGER` | Operations: sees **all** tickets, creates, triages, assigns, changes team/priority, closes. Cannot manage members or structure. |
| `STAFF` | Works tickets. Sees tickets of their teams, assigned to them, or created by them. |
| Team Lead | A `STAFF` (or higher) with `isLead` in a team: manages **that team's** tickets (assign within team, priority, resolve, close, sub-tickets). |
| Requester | Not a role. Any logged-in user; sees only tickets they raised, via "My complaints". |

One user can be Admin in organization A, Staff in B, and a requester in C.

### 5.2 Ticket visibility (one rule, written once)

A member can see a ticket if **any** is true:

1. role is `ADMIN` or `MANAGER`;
2. they are the assignee;
3. the ticket's team is one of their teams;
4. they created it (internal tickets).

This is implemented once (`buildTicketVisibilityWhere`) and reused by the
list, detail, search, comments, and dashboard so counts always equal lists.
Requesters do **not** use this rule; they use `GET /me/tickets`, which filters
by `requesterId = me`.

### 5.3 Permission matrix

"Own team" means the ticket's team is one the person leads (Lead) or belongs
to (Staff).

| Action | Admin | Manager | Team Lead | Staff |
| --- | :-: | :-: | :-: | :-: |
| Settings, portal toggle, members, invitations, teams, categories | Yes | - | - | - |
| View tickets | all | all | own team + assigned + created | own team + assigned + created |
| Create internal ticket | any team | any team | own team | own team, may only self-assign |
| Create sub-ticket | any | any | parent in own team | - |
| Assign / reassign / unassign | anyone eligible | anyone eligible | members of own team | - |
| Take an unassigned ticket (self-assign) | Yes | Yes | Yes | own team only |
| Change team | Yes | Yes | - | - |
| Change priority, due date, category | Yes | Yes | own team | - |
| Edit subject / description | Yes | Yes | - | - |
| Working status (in progress, waiting, resolved, back to open) | Yes | Yes | own team | only if assignee |
| Close (with reason) | Yes | Yes | own team | - |
| Reopen a `CLOSED` ticket (reason required) | Yes | Yes | - | - |
| Comment (public reply / internal note) | any member who can see the ticket | | | |
| Dashboard | scoped by the visibility rule | | | |

Rules:

- Permissions are evaluated **on the server** on every request from the
  membership loaded for that request. The UI hides actions but is never the
  security boundary.
- The ticket detail response includes `allowedActions` so the UI only shows
  what the current user may do.
- Admin cannot be demoted/removed if they are the last active Admin.

## 6. The two flows

### 6.1 Flow A - Top-down (internal tickets)

1. **Setup (Admin):** create organization -> create teams -> invite Managers
   and Staff -> add people to teams -> mark one or more team Leads.
2. **Create:** a Manager (or Admin, Lead, Staff within their limits) opens
   *New ticket*: subject, description, priority, optional due date, optional
   category, optional **team**, optional **assignee**. Status starts `OPEN`.
3. **Route:**
   - assignee chosen -> they get an email, ticket is on their list;
   - only a team chosen -> the team's Leads get an email ("needs assignment");
     the ticket sits in the team queue; the Lead assigns it, or a team member
     takes it;
   - nothing chosen -> appears in the **Unassigned** queue for Managers/Admins.
4. **Break down (Lead / Manager):** on the ticket, *Add sub-ticket* creates
   child tickets, each with its own assignee, priority, and due date. The
   parent shows progress ("2 of 4 done").
5. **Work:** assignee moves `OPEN -> IN_PROGRESS -> RESOLVED` and writes
   internal notes. The parent cannot be resolved or closed until all
   sub-tickets are `RESOLVED` or `CLOSED`.
6. **Finish:** Lead/Manager closes the ticket (`COMPLETED`), or it
   auto-closes 7 days after being resolved.

### 6.2 Flow B - Bottom-up (portal complaints)

1. **Discover:** the organization shares its portal link `/o/{slug}`
   (website, QR code, email signature).
2. **Submit:** the requester opens the portal, clicks *Submit a complaint*,
   logs in or registers (and verifies email), picks a **public category**,
   writes subject and description. They land back on the form after login.
3. **Create:** ticket is created with `source = PORTAL`, `status = OPEN`,
   `priority = MEDIUM`, requester = that user, and **team = the category's
   default team** (or none). The requester gets a "complaint received" email
   with the reference (e.g. `T-42`).
4. **Triage:** if routed, the team's Leads are emailed; if not (no team, or
   team has no Lead), Managers and Admins are. The Lead/Manager assigns it,
   or closes it as `REJECTED` with a note (spam, invalid, duplicate).
5. **Work:** staff add **internal notes** (private) and **public replies**
   (emailed to the requester). If staff need more information they set
   `WAITING_ON_REQUESTER`.
6. **Requester side (`/my/complaints`):** the requester sees status, the public
   conversation, and can reply. A reply while `WAITING_ON_REQUESTER` moves the
   ticket back to `IN_PROGRESS` (or `OPEN` if unassigned); a reply on a
   `RESOLVED` ticket **reopens** it. The requester can **withdraw** while the
   ticket is still `OPEN`.
7. **Finish:** staff set `RESOLVED` -> requester is emailed -> requester clicks
   *Yes, it's resolved* (`CLOSED / COMPLETED`), or replies to reopen, or after
   7 days it auto-closes. Replies on `CLOSED` tickets are blocked; the page
   offers *Submit a new complaint*.

### 6.3 Where the two flows meet

A complaint can be split exactly like an internal ticket: the Lead creates
**internal sub-tickets** under it for staff. The requester only ever sees the
parent complaint and its public replies - never sub-tickets, internal notes,
assignees' emails, or other tickets.

## 7. Ticket rules

### 7.1 Statuses

| Status | Meaning | Open workload |
| --- | --- | :-: |
| `OPEN` | Created or accepted; waiting for assignment or work. | Yes |
| `IN_PROGRESS` | Someone is working on it. Needs an assignee. | Yes |
| `WAITING_ON_REQUESTER` | Staff need information. Only when the ticket has a requester. | Yes |
| `RESOLVED` | Staff believe it is done; requester can confirm or reply to reopen. | - |
| `CLOSED` | Final. Always has a close reason. | - |

There is no separate "new/triage" status: triage is simply the **unassigned /
unrouted queue** of `OPEN` tickets. Fewer states, fewer bugs.

### 7.2 Close reasons

| Reason | Used when | Requester emailed |
| --- | --- | :-: |
| `COMPLETED` | Work done (after `RESOLVED`, or closed directly). | Yes |
| `REJECTED` | Spam, invalid, out of scope, or duplicate. **Note required.** | Yes |
| `CANCELLED` | Withdrawn by the requester or cancelled by a Manager/Lead. | Yes |

### 7.3 Transition table

Actors: **Asg** = assignee, **Lead** = Lead of the ticket's team,
**M+** = Manager/Admin, **Req** = requester, **Sys** = system job.

| From -> To | Allowed actors | Notes |
| --- | --- | --- |
| `OPEN -> IN_PROGRESS` | Asg, Lead, M+ | Requires an assignee. |
| `OPEN/IN_PROGRESS -> WAITING_ON_REQUESTER` | Asg, Lead, M+ | Requires a requester on the ticket. |
| `IN_PROGRESS/WAITING -> OPEN` | Asg, Lead, M+ | Put back in the queue. |
| `WAITING -> IN_PROGRESS` | Asg, Lead, M+, **Sys on requester reply** | `OPEN` instead if unassigned. |
| `OPEN/IN_PROGRESS/WAITING -> RESOLVED` | Asg, Lead, M+ | Sets `resolvedAt`. All sub-tickets must be `RESOLVED`/`CLOSED`. |
| `RESOLVED -> IN_PROGRESS/OPEN` (reopen) | Asg, Lead, M+, **Sys on requester reply** | `IN_PROGRESS` if assigned, else `OPEN`. Clears `resolvedAt`. |
| `RESOLVED -> CLOSED (COMPLETED)` | Lead, M+, Req ("yes, resolved"), Sys after 7 days | Sets `closedAt`. |
| `OPEN/IN_PROGRESS/WAITING -> CLOSED` | Lead, M+ | Reason `COMPLETED`, `REJECTED`, or `CANCELLED`. All sub-tickets must be `RESOLVED`/`CLOSED`. |
| `OPEN -> CLOSED (CANCELLED)` | Req (withdraw) | Only while `OPEN`. |
| `CLOSED -> OPEN` | Admin, Manager | Reason text required; recorded in activity. |

Anything not listed is rejected with `409 INVALID_TRANSITION` and nothing
changes. The table lives in **one module** (`tickets/status-machine.ts`) and is
unit-tested exhaustively.

### 7.4 Priority, due date, reference number

- Priority: `LOW`, `MEDIUM` (default), `HIGH`, `URGENT`. Requesters cannot set it.
- Due date: optional calendar date. A ticket is **overdue** when it is in open
  workload and its due date is before today.
- Reference: `T-{number}`, unique per organization, allocated by an atomic
  counter increment inside the creation transaction (never `MAX()+1`). The
  reference is public-safe and never grants access.

### 7.5 Assignment

- A ticket can have a team, an assignee, both, or neither.
- **Assignee eligibility** (checked on every assignment): the assignee has an
  `ACTIVE` membership in the **same organization**, and, if the ticket has a
  team, is a member of that team **or** is Manager/Admin.
- Changing a ticket's team clears the assignee if they are no longer eligible;
  the change is recorded in activity.
- Assignment does not change status by itself.

### 7.6 Sub-tickets

- A sub-ticket is a normal ticket with `parentId`. **One level only**: a
  sub-ticket cannot have its own sub-tickets, and an existing ticket cannot be
  re-parented.
- Sub-tickets are always `INTERNAL`, have no requester, default to the parent's
  team, and may have any eligible assignee.
- The parent cannot become `RESOLVED` or `CLOSED` while any sub-ticket is not
  `RESOLVED`/`CLOSED`.
- Sub-tickets follow the same visibility, permission, and status rules.

### 7.7 Comments and activity

- Comments are **plain text** (never rendered as HTML), 1-10,000 characters,
  **immutable** (no edit/delete).
- Members choose `PUBLIC` or `INTERNAL`. The composer defaults to `INTERNAL`;
  the public option is visually distinct. Public replies are only allowed on
  tickets that have a requester. Requester comments are always `PUBLIC`.
- Requester APIs and emails exclude internal notes **in the database query**,
  not after fetching.
- Activity entries record actor, type, from, to, and time for: created, status,
  assignment, team, priority, due date, category, edit, sub-ticket added.

### 7.8 Auto-close

A job closes tickets that have been `RESOLVED` for **7 days** without
requester activity: `CLOSED / COMPLETED`, actor = system, requester emailed.
Applies to internal tickets and sub-tickets too. The 7-day window is a
constant in the MVP.

### 7.9 Concurrency

No optimistic-lock version column. Instead: status changes use a conditional
update (`WHERE id = ? AND status = <expected>`) so two people cannot apply
conflicting transitions; the loser gets `409 INVALID_TRANSITION` and reloads.
For other fields, last write wins, and every change is in the activity
timeline. (Decision D-10.)

## 8. Organizations, members, and accounts

### 8.1 Accounts

- Register with name, email, password. Email is trimmed and lowercased; unique.
- Password 8-128 characters, hashed with **Argon2id**.
- Email must be verified (link valid 24 h, single use) before the user can
  create an organization, accept an invitation, or submit a complaint.
  Unverified users can log in but only see a "verify your email" screen with a
  resend button (rate-limited).
- Forgot/reset password: link valid 1 h, single use; a successful reset
  revokes **all** sessions.
- Registration, login failure, and forgot-password give **generic responses**
  so nobody can probe which emails exist.
- Changing the account email is not supported in the MVP.
- Sessions: opaque random cookie, stored hashed in the database, 7 days
  sliding expiry, revocable.

### 8.2 Organization creation

- A verified user submits **name** and **slug**. Organization + the creator's
  `ADMIN` membership are created in **one transaction**.
- Slug: 3-40 chars, lowercase letters/digits/hyphens, starts and ends with a
  letter or digit; globally unique; **immutable** (URLs stay stable). The name
  can change.
- New organizations have `portalEnabled = false`. The Admin enables the portal
  after creating at least one active **public** category.

### 8.3 Members and invitations

- Admin invites by **email + role**. The invitee receives a link
  (`/invite#token=...`, valid 7 days, single use).
- Accepting requires being logged in with a **verified account whose email
  equals the invitation email**.
- One pending invitation per (organization, email). *Resend* issues a new token;
  *Revoke* cancels it. Inviting an existing active member is rejected.
- Inviting a previously removed member **reactivates** their old membership.
- Admin can change a member's role or **remove** them (soft remove; row kept).
- **Last-Admin protection:** the last active Admin cannot be demoted or removed.
- Teams: Admin creates/renames/archives teams, adds or removes members, and
  toggles Lead.

### 8.4 Member offboarding

When a member is removed:

1. Access ends on their **next request** (membership checked every request).
   Their login and other organizations are unaffected.
2. They are removed from all teams of that organization.
3. Their open tickets become **unassigned** (team kept) with a system activity
   entry "unassigned: member removed".
4. Their past comments, activity, and created tickets stay, with their name
   shown plus "(removed)".

Removing someone from a single team unassigns only that team's tickets.

## 9. Email notifications

Ticket emails go through a small **outbox** (rows saved in the same
transaction as the change, sent by a background poller with retries).
Account emails (verify, reset, invite) are sent immediately because they carry
one-time tokens. Emails never contain internal notes or other tickets; all
links use `APP_ORIGIN`; each says replies are not monitored.

| Event | Recipient | Trigger |
| --- | --- | --- |
| Verify email | User | Register / resend |
| Password reset | User | Forgot password |
| "You already have an account" | Existing user | Someone registers with their email |
| Invitation | Invitee | Admin invites |
| Complaint received | Requester | Portal submission |
| Needs assignment | Team Leads of the ticket's team; if no team or no Lead -> Managers + Admins (never the actor) | Ticket created or moved without an assignee |
| Assigned to you | Assignee (if not self) | Assignment, including sub-tickets |
| Staff replied | Requester | Public reply |
| We need information | Requester | Status -> `WAITING_ON_REQUESTER` |
| Requester replied | Assignee; if unassigned -> team Leads / Managers | Requester comment (no content in email) |
| Resolved | Requester | Status -> `RESOLVED` ("confirm or reply within 7 days") |
| Closed | Requester | Status -> `CLOSED` (reason shown) |

Internal tickets without a requester never send requester emails.

## 10. Edge cases and expected handling

### Accounts and sessions

| Scenario | Expected behavior |
| --- | --- |
| Register with an existing email | Same "check your email" response; existing owner gets a notice email. |
| Unverified user creates an org / submits a complaint | `403 EMAIL_NOT_VERIFIED`; UI offers resend. |
| Verification or reset link expired / used | Clear message with a way to request a new one. |
| Wrong password repeatedly | Generic error + rate limit; no account lockout. |
| Reset requested for unknown email | Same generic response; no email sent. |
| Password reset done | All sessions revoked. |
| Logout with a stolen cookie | Session revoked server-side; cookie unusable. |
| Two browser tabs in two organizations | Works: the organization comes from the URL slug. |
| Session expires mid-work | `401` -> login page -> return to the same URL. |

### Organizations and members

| Scenario | Expected behavior |
| --- | --- |
| Duplicate slug (or two users submit at once) | Unique constraint wins; loser gets `409` with a field error. |
| Guessing another organization's slug/ticket number | `404`, identical to "does not exist". |
| Member removed while logged in | Next request to that org -> `404`; other orgs unaffected. |
| Remove or demote the last Admin | `422 LAST_ADMIN`. |
| Invitation expired / revoked / used | Rejected; Admin can resend. |
| Invitation accepted with a different email | Rejected: "sent to another email address". |
| Invite an existing member | `409 ALREADY_MEMBER`. |
| Portal enabled with no public category | Rejected with an explanation. |
| Last public category archived while portal enabled | Portal shows "not accepting complaints". |

### Teams and categories

| Scenario | Expected behavior |
| --- | --- |
| Duplicate team/category name (case-insensitive) | `409` field error. |
| Archive a team with open tickets | Allowed; tickets keep it and stay workable; it cannot be chosen for new tickets; UI shows the open-ticket count. |
| Category's default team archived | Complaint becomes unrouted (Managers triage). |
| Category archived | Disappears from the portal; existing tickets keep it. |
| Team with no members / no Lead | Tickets stay in its queue; "needs assignment" goes to Managers + Admins. |
| Member removed from a team | Their tickets in that team become unassigned (activity logged). |

### Tickets

| Scenario | Expected behavior |
| --- | --- |
| Missing/too long fields | `400` with field errors (subject 3-200, description 10-10,000). |
| Archived, internal-only, or other-org category / team | `400`/`422` clear error; nothing created. |
| Assignee from another org, removed, or outside the team | `422 ASSIGNEE_NOT_ELIGIBLE`. |
| Staff creates a ticket for another team or assigns it to someone else | `403`. |
| Invalid or unauthorized status change | `409 INVALID_TRANSITION` / `403`; ticket unchanged. |
| `WAITING_ON_REQUESTER` on a ticket without requester | `422`. |
| Public reply on a ticket without requester | `422`; only internal notes. |
| Two people change the status at once | One wins; the other gets `409` and reloads. |
| Two tickets created at the same moment | Atomic counter: unique numbers. |
| Resolve/close a parent with unfinished sub-tickets | `422 OPEN_SUBTICKETS`, listing them. |
| Create a sub-ticket under a sub-ticket | `422`. |
| Team changed while an ineligible person is assigned | Assignee cleared, activity records it. |
| Database failure while creating a ticket | Whole transaction rolls back: no ticket, counter jump, activity, or email row. |
| Wrongly rejected ticket | Admin/Manager reopens `CLOSED -> OPEN` with a reason. |

### Portal and requesters

| Scenario | Expected behavior |
| --- | --- |
| Unknown slug or portal disabled | Safe "not available / not accepting complaints" page; no submission. |
| Double click on submit | Button disabled while sending; duplicate subjects are not blocked but are cheap to close as `REJECTED`. |
| Spam or flood | Login required + email verified + per-user rate limit; staff close as `REJECTED`. |
| Requester opens another user's ticket URL | `404`. |
| Requester replies on `RESOLVED` | Ticket reopens. |
| Requester replies on `CLOSED` | Blocked (`409`); page offers a new complaint. |
| Requester withdraws after work started | Blocked; they reply instead and staff can cancel. |
| Requester is also staff in the same org | Separate identities: "My complaints" shows only public data. |
| Portal disabled after submission | Existing requesters still view and reply to their tickets. |

### Email and jobs

| Scenario | Expected behavior |
| --- | --- |
| Email provider down | Change is saved; ticket email retried (3 attempts, backoff) then marked `FAILED` and logged. Account emails: user can resend. |
| Server restarts mid-send | Rows stuck in `SENDING` for 10 min return to `PENDING` (at-least-once). |
| Server asleep (free tier) | Jobs resume on wake; auto-close may run late (documented). |
| Auto-close vs requester reply at the same moment | Conditional update (`WHERE status = 'RESOLVED'`): one wins cleanly. |

### Dashboard

| Scenario | Expected behavior |
| --- | --- |
| Counts vs list | Same visibility builder + same filter builder; an automated test compares them for every role. |
| Staff dashboard | Only tickets that staff member can see. |

## 11. Technology stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript (strict) |
| Frontend | React + Vite, React Router, TanStack Query, React Hook Form + Zod |
| UI | Tailwind CSS + shadcn/ui |
| Backend | Node.js LTS + Express + TypeScript |
| Database / ORM | PostgreSQL + Prisma |
| Auth | Opaque server-side sessions (cookie), Argon2id (`argon2`) |
| Security | Helmet, `express-rate-limit`, Origin check, Zod validation |
| Logging | Pino with redaction + request IDs |
| Email | Resend (HTTP API) in production, `console` transport in development |
| Tests | Vitest + Supertest (real test database) |
| Quality | ESLint + Prettier |
| Hosting (Phase 11) | Render (one service: API + built React app) + Neon (PostgreSQL) |
| Containers / CI (last phase) | Docker + Docker Compose, GitHub Actions |

**Intentionally not used:** Redis, queues (BullMQ), WebSockets, Nginx,
microservices, Zustand (add only if truly needed), Playwright, OpenAPI
tooling, Turnstile/CAPTCHA, object storage. Add only when a real requirement
appears.

## 12. Repository structure

```text
complaint-ticket-portal/
├── client/                 # React + Vite SPA (portal, auth, workspace)
│   └── src/
│       ├── app/            # providers, router, layouts, route guards
│       ├── components/     # shared UI (shadcn/ui)
│       ├── features/       # auth, orgs, members, teams, categories,
│       │                   # tickets, portal, my-complaints, dashboard
│       ├── lib/            # api client, query keys, helpers
│       └── main.tsx
├── server/
│   ├── prisma/             # schema.prisma, migrations/, seed.ts (dev only)
│   ├── scripts/            # one-off scripts (if any)
│   └── src/
│       ├── config/         # env parsing (Zod), constants
│       ├── middleware/     # session, org membership, errors, rate limits, origin check
│       ├── modules/        # auth, orgs, members, invitations, teams, categories,
│       │                   # tickets, comments, portal, requester, dashboard, notifications
│       ├── jobs/           # email poller, auto-close, cleanup
│       ├── shared/         # permissions, visibility, filters, crypto, errors
│       ├── app.ts
│       └── server.ts
├── docs/                   # demo script, known limitations (Phase 10)
├── report_implementation/  # PRIVATE learning notes per phase (git-ignored)
├── bug_report/             # PRIVATE bug write-ups (git-ignored)
├── .gitignore
├── README.md
├── architecture.md
└── planning.md
```

Create folders when a module is introduced; do not create empty layers.
`Dockerfile`, `docker-compose.yml`, and `.github/workflows/` appear only in the
last phase.

## 13. Environment configuration

`.env` files locally; platform settings in deployment. Only `.env.example`
files are committed. The server validates its environment with Zod at startup
and refuses to start when something is missing or invalid.

`server/.env.example`

```env
NODE_ENV=development
PORT=5000
APP_ORIGIN=http://localhost:5173
TRUST_PROXY=0
DATABASE_URL=postgresql://postgres:password@localhost:5432/ctp_dev
TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/ctp_test
EMAIL_TRANSPORT=console
RESEND_API_KEY=
EMAIL_FROM="Complaint Portal <no-reply@example.com>"
JOBS_ENABLED=true
LOG_LEVEL=info
```

`client/.env.example`

```env
VITE_API_BASE_URL=/api/v1
```

| Variable | First needed | Notes |
| --- | --- | --- |
| `DATABASE_URL`, `TEST_DATABASE_URL` | Phase 1 | Local PostgreSQL. Separate databases for dev and test. |
| `APP_ORIGIN` | Phase 2 | Used in email links and the Origin check. |
| `EMAIL_TRANSPORT=console` | Phase 2 | Emails print in the server terminal; no key needed. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Phase 11 | Only for real emails in production. |
| `TRUST_PROXY` | Phase 11 | Number of proxies in front of the server (Render: `1`). |

No JWT secret is needed: session and email tokens are random and stored hashed.
Nothing secret may start with `VITE_`.

## 14. Local development (Windows / PowerShell)

```powershell
# 1. Create databases (or use pgAdmin)
psql -U postgres -c "CREATE DATABASE ctp_dev;"
psql -U postgres -c "CREATE DATABASE ctp_test;"

# 2. Server
cd server
npm install
Copy-Item .env.example .env        # then edit DATABASE_URL / TEST_DATABASE_URL
npx prisma migrate dev
npm run seed                       # optional: demo data (dev only, password Password123!)
npm run dev                        # http://localhost:5000

# 3. Client (second terminal)
cd client
npm install
Copy-Item .env.example .env
npm run dev                        # http://localhost:5173 (proxies /api to :5000)
```

- Emails print to the **server terminal** (`EMAIL_TRANSPORT=console`); copy the
  link from there.
- Before every commit: `npm run format:check`, `npm run lint`,
  `npm run typecheck`, `npm test` (server), `npm run build` (in `server/` and `client/`).
  `npm run format` fixes formatting.
- Stop `npm run dev` before `npx prisma migrate dev` on Windows (the running
  server locks Prisma's engine file).
- Docker is **not** needed until the final phase.

## 15. Testing strategy

**Unit (Vitest):** status machine (every from/to/actor), permission matrix
rows, visibility builder, assignee eligibility, slug validation, token
hashing, email normalization.

**API integration (Vitest + Supertest + real test DB):** auth flows and
generic responses; organization/member/invitation rules incl. last-Admin;
teams and categories; ticket create/list/filter/search; assignment;
transitions; sub-ticket rules; comments visibility; portal submit;
requester endpoints; email outbox rows; auto-close; dashboard = list counts.

**Always written together with each feature:**

- the success case,
- an invalid-input case,
- a **permission-denied** case,
- a **cross-organization** case (must return `404` and change nothing).

**Manual journeys** (checklist in `planning.md` section 5) are run before
deployment.

## 16. Deployment

One deployable service keeps cookies first-party and everything simple:

```text
Browser -> Render web service (Express: /api/* + serves the built React app)
                         |-> Neon PostgreSQL
                         |-> Resend (email)
```

- Build: install, `prisma generate`, build client, build server.
- Start: `prisma migrate deploy` then `node dist/server.js`.
- `TRUST_PROXY=1`, `JOBS_ENABLED=true`, `NODE_ENV=production`.
- Free-tier limitation: the service sleeps when idle (slow first request, jobs
  pause). Documented in `docs/known-limitations.md`.
- Resend only emails addresses other than your own after you verify a domain.
  Without a domain, demo with your own email addresses or use the console
  transport locally.
- Docker/CI are added **after** this works (last phase).

## 17. Scope: MVP, cut list, later

**MVP = Phases 0-12 in `planning.md`.**

If time runs short, cut in this order (never weaken security or isolation):

1. Dashboard breakdowns (keep headline counts).
2. Due date / overdue metric.
3. Search (keep filters).
4. Invitation resend/revoke buttons (keep create + accept).

**Never cut:** tenant isolation, permission checks, internal-note filtering,
hashed tokens, rate limits, transactions on create/status changes, the
cross-organization tests, sub-tickets (core to the product story).

**Later (post-MVP):** anonymous complaints via emailed magic link + CAPTCHA,
attachments, audit-log screen, platform super-admin, SLA/escalation rules,
real-time updates, in-app notifications and preferences, per-organization
settings (auto-close days, default priority), reports/exports, custom fields
and workflows, AI-assisted categorization with human review, languages,
mobile app.

## 18. Decision log

| ID | Decision | Why |
| --- | --- | --- |
| D-01 | One ticket model with two entry paths (`INTERNAL`, `PORTAL`) | One lifecycle, one dashboard, less code. |
| D-02 | Requesters must have a verified account | Removes magic links, requester sessions, recovery flow, and CAPTCHA; gives "My complaints" for free; blocks most spam. Anonymous complaints are a "later" item. |
| D-03 | Roles: `ADMIN`, `MANAGER`, `STAFF` + per-team Lead flag | Covers "admin/manager creates, lead splits, staff works" without Owner/Admin hierarchy. |
| D-04 | "Team" is the single grouping concept | One word, one table; covers departments. |
| D-05 | Sub-tickets: one level, parent waits for children | Matches Lead-splits-work story; avoids tree complexity. |
| D-06 | Five statuses, no `NEW` | Triage = unassigned queue. Fewer transitions. |
| D-07 | Server-side sessions, not JWT | Instant revocation, simpler than refresh-token rotation. |
| D-08 | Express serves the React build in production | One origin: no CORS, first-party cookies, simplest Docker later. |
| D-09 | Outbox for ticket emails; account emails sent directly | Retries where it matters; no plaintext tokens stored. |
| D-10 | No optimistic-lock version; conditional status updates + activity log | Enough protection, much less UI plumbing. |
| D-11 | Slugs immutable; URLs use the slug | Stable links; no id lookup on every route. |
| D-12 | Cross-tenant access returns `404` | Does not reveal what exists. |
| D-13 | Comments are plain text and immutable | No XSS surface; record stays trustworthy. |
| D-14 | Docker and CI come last | Feature work never blocked by tooling. |
| D-15 | Removed from the first draft: platform admin, audit log, Turnstile, magic-link requester access, idempotency keys, composite foreign keys, Playwright, OpenAPI | Too heavy for a solo project; isolation is enforced by middleware, org-scoped queries, and tests instead. |
| D-16 | Staff and Leads must choose one of their teams when creating a ticket; only Managers/Admins create team-less tickets | "Own team" in the matrix implies a team; keeps the Unassigned queue for Managers. |
| D-17 | A Lead assigns only members of the ticket's team (even though Managers are eligible for every team) | Matches "members of own team" in the matrix. |
| D-18 | When an `IN_PROGRESS` ticket loses its assignee (removal, team change) it returns to `OPEN` with a system activity | `IN_PROGRESS` needs an assignee; avoids a hidden half-state. |
| D-19 | Removing a Manager/Admin from a team does not unassign their tickets | They stay eligible for every team (section 7.5). |
| D-20 | Sub-tickets cannot be added to a `RESOLVED` or `CLOSED` parent; requester withdraw and confirm also wait for sub-tickets | One rule: a parent never finishes before its parts. |
| D-21 | Field edits and assignment are blocked on `CLOSED` tickets (reopen first) | A closed record stays stable; reopening is logged. |

If implementation raises a new question: write it down, pick the simplest
answer consistent with these decisions, add a row here, add a test that locks
it in.

## 19. Success criteria

- A user can register, verify, create an organization, invite members, create
  teams and Leads, and enable the portal.
- A Manager can create a ticket, assign it to a team, and a Lead can split it
  into sub-tickets for staff; the parent closes only after its sub-tickets.
- A customer can submit a complaint, receive emails, reply, and confirm
  resolution; they never see internal notes or other tickets.
- A member of one organization cannot read or change anything in another
  (proven by automated tests).
- Dashboard counts equal list totals for every role.
- All local checks pass; the app is deployed and reachable; Docker works from a
  clean clone.

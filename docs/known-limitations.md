# Known limitations

Deliberate MVP trade-offs (README sections 3 and 17, architecture section 17) and things found during hardening.

## By design
- **One server instance.** Rate limits are in memory and the email poller claims rows without `FOR UPDATE SKIP LOCKED`. Running two instances would need a shared rate-limit store and that locking change.
- **Free-tier sleep (Render).** The first request after idling is slow, and background jobs pause while asleep. Jobs run once at start-up, so auto-close and emails catch up on wake, but can be late.
- **Email is at-least-once.** If the server dies while sending, the row is retried after 10 minutes, so a rare duplicate email is possible; a lost email is not.
- **Retries:** 3 attempts (wait 1 min, then 5 min), then `FAILED` (logged). There is no screen to resend failed ticket emails.
- **Login is required to complain.** No anonymous complaints, magic links, or CAPTCHA.
- **No attachments, rich text, real-time updates, SLAs, custom fields, exports, or audit-log screen.**
- **Last write wins** for non-status fields (priority, due date, ...). Every change is in the activity timeline. Status and assignment changes are protected against conflicts.
- **English only**; dates use the browser's locale; due dates are calendar dates compared in UTC.
- **Changing your account email is not supported.**
- **Sub-tickets are one level deep.**

## Found in Phase 10 hardening
- **`npm audit` (server):** `zod` < 4.6.6 (memory use when validating very large constrained arrays). Our only zod arrays are the short `status` / `priority` lists in a query string, capped by Node's 16 KB header limit, and JSON bodies are capped at 100 kB. Fix = migrate to zod 4 (breaking API changes; post-MVP). The other findings (`prisma` CLI, `vitest`) are development tools that are not part of the running app.
- **Client:** 0 audit findings.
- **Browser checks:** the journeys were verified through the API and by building the UI. A full manual click-through and the phone-width check should be done in a browser before the demo.
- **Seed data uses `.test` email addresses**; they cannot receive real email (fine locally with the console transport).

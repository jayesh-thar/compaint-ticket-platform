# Demo script (Journeys A-E)

A 15-minute walk-through for a viva or a client. Run locally first:

```powershell
cd server; npm run seed; npm run dev      # terminal 1 (emails print here)
cd client; npm run dev                    # terminal 2 -> http://localhost:5173
```

`npm run seed` creates **City College** (`/w/city-college`, portal `/o/city-college`) and **Acme Shop**.
Every seeded password is `Password123!`. Use a private window for a second person.

| Account | Role |
| --- | --- |
| admin@city.test | Admin |
| manager@city.test | Manager |
| itlead@city.test | IT team Lead |
| it1@city.test, it2@city.test | IT staff |
| student@city.test | Requester (student) |
| admin@shop.test | Admin of the *other* organization |

## Journey A - set up an organization (fresh account)
1. Register a new account, copy the verify link from the server terminal, log in.
2. *Create organization* (you become Admin). Teams: create **IT** and **Hostel**.
3. Categories: **Wi-Fi**, public, default team IT. Settings: **Open the portal**.
4. Members: invite a Manager and two Staff (links appear in the terminal); accept each in a private window.
5. Teams: add both Staff to IT, **Make Lead** on one.

## Journey B - top-down with sub-tickets (seeded data)
1. As **manager@city.test**: *New ticket* for IT with no assignee.
2. Terminal shows "needs assignment" email to the IT Lead (within ~15 s).
3. As **itlead@city.test**: open it, pick an assignee, *Add sub-ticket* twice (it1, it2).
4. Try *Resolve* on the parent -> refused: "finish the sub-tickets first".
5. As it1 / it2: *Start work* -> *Resolve* their sub-tickets. Parent shows "2 of 2 done".
6. Lead resolves and *Close...* the parent. Show the activity timeline.

## Journey C - bottom-up complaint
1. Private window: `/o/city-college` -> *Submit a complaint* -> log in as **student@city.test** -> back on the form.
2. Submit a Wi-Fi complaint -> reference shown; "complaint received" email in the terminal.
3. As the IT Lead: it is in the IT queue (Tickets -> *Unassigned*); assign it; staff *Start work*.
4. Student -> *My complaints* shows only their own complaints.

## Journey D - communication and privacy
1. Staff: write an **internal note** (amber) and a **public reply** (green).
2. Student: sees the reply, not the note (page and the email in the terminal).
3. Staff: *Wait on requester* -> student replies -> status back to *Being worked on*; assignee emailed.
4. Log in as **admin@shop.test** and open `/w/city-college/tickets/1` -> "not found" (other organization).

## Journey E - completion
1. Staff *Resolve* -> student gets "resolved" email -> *Yes, it's resolved* -> Closed.
2. Student tries to reply -> blocked, *Submit a new complaint* offered.
3. Auto-close: in pgAdmin, on a RESOLVED ticket run
   `UPDATE tickets SET "resolvedAt" = now() - interval '8 days' WHERE number = <n>;`
   then restart the server (jobs run at start-up) -> the ticket is Closed (Completed).
4. Reject path: Lead closes a spam complaint with reason **Rejected** and a note.
5. Dashboard: click any card - the list shows exactly that many tickets.

## Verified
The API version of these journeys was run end to end against a live server on 2026-11-27 (33 checks, all passed).

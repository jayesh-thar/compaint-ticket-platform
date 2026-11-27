# Demo script

Version 3 (README section 0) replaces the v2 journeys. The full v3 demo
script is written in Phase 17 of `planning.md`.

There is **no demo data and there are no demo accounts**: start from an empty
database and create everything by hand.

```powershell
cd server; npx prisma migrate deploy; npm run dev   # terminal 1 (email links print here as JSON)
cd client; npm run dev                              # terminal 2 -> http://localhost:5173
```

1. Open `/` (landing page) -> **Create account** -> sign in.
2. **Create organization** -> you are its Admin.
3. Links that would be emailed (invitations, password reset) are printed in
   terminal 1 as a JSON block (`"link": "http://localhost:5173/..."`).

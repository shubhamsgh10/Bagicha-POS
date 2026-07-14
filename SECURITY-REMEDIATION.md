# Security Remediation — Owner Action Required

Some fixes cannot be made in code. Do these **before delivering to the client**.

## 1. Rotate leaked database credentials (CRITICAL — do this first)

A `.env` file with **working Supabase/Postgres credentials was committed to git history**
(commits `301b2b0`, `d373a1c`; removed from tracking in `05a183d` but still recoverable
from history by anyone who has ever cloned or forked the repo).

Leaked passwords include `Shubsgh@1005` and a second Supabase project password. Treat both
databases as compromised.

**Steps:**
1. In the Supabase dashboard → Project Settings → Database → **reset the database password**
   for **both** affected projects (`voxwupcpyniajcaiixtq` and `hyokfpalmpiohqrwkfta`).
2. Update `DATABASE_URL` in your local `.env`, in Vercel env vars, and in the Electron host
   config (`userData/host-config.json` / the baked build value).
3. If the password `Shubsgh@1005` was reused anywhere else (email, other services), change it there too.

## 2. Purge the secret from git history

Rotating is enough to make the leaked value useless, but also scrub history so it isn't
re-leaked:

```bash
# Using git-filter-repo (recommended)
pip install git-filter-repo
git filter-repo --path .env --invert-paths

# then force-push (coordinate with anyone else who has a clone — they must re-clone)
git push origin --force --all
git push origin --force --tags
```

Or use BFG: `bfg --delete-files .env && git reflog expire --expire=now --all && git gc --prune=now --aggressive`.

## 3. Rotate the Pusher app

Realtime is currently mirrored to a **public** Pusher channel (`bagicha-pos`) whose key is
baked into the browser bundle, so anyone on the internet could subscribe and read live orders,
customer phone numbers, and WhatsApp message bodies.

- This branch migrates realtime to a **private Pusher channel**: the server exposes
  `POST /api/pusher/auth` (session-gated) and the client authorizes its subscription there,
  so only a logged-in session can receive events. For this to work you must set the channel
  name to a `private-` value **consistently** on both sides, in every deployment:
  - Server: `PUSHER_CHANNEL=private-bagicha-pos` (Vercel env + Electron host `host-config.json`).
  - Client: `VITE_PUSHER_CHANNEL=private-bagicha-pos` (Vercel build env; the desktop release
    workflow is already updated).
  - If server and client channel names don't match, live updates silently stop — verify after
    changing (open the app, place an order on one device, confirm it appears on another).
- Also rotate the Pusher app: create a **new** app and replace `PUSHER_*` / `VITE_PUSHER_*` so
  the old key (which was public and may have carried sensitive data) is dead.

## 4. Set a strong SESSION_SECRET in every deployment

The server now **refuses to boot in production without `SESSION_SECRET`** (no more hardcoded
fallback). Generate one and set it in local `.env`, Vercel, and the Electron host config:

```bash
openssl rand -hex 32
```

## 5. Change the default admin password

On first boot the app seeds `admin` / `admin123`. Log in and change it immediately
(Profile → Change Password), or the client's system ships with a public default credential.

---

_Follow-up hardening (not blocking delivery, tracked in the audit plan): hash staff PINs,
move Pusher to a private channel, add pagination to large list endpoints, reduce redundant
polling, and add offline cart persistence._

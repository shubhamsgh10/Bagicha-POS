# macOS signing + auto-update — setup & spike checklist

**Run this on the Mac.** Every step is copy-paste. Branch: `Thermal-Printer`.

---

## Start here — paste this into Claude Code on the Mac

> Read `docs/MAC-SIGNING.md`. We're on the `Thermal-Printer` branch. Goal: prove a self-signed
> certificate makes macOS auto-update work, so this Mac stops needing hand-delivered builds.
> `electron-builder.yml`'s `mac:` section is already prepped (`identity` + `hardenedRuntime: false`).
> Work through Phase 0 and tell me the result of each verification step. Stop and ask me before
> anything that needs `sudo`. This is a live restaurant POS machine — don't touch the database,
> printers, or WhatsApp session.

---

## Plain English — what we're doing and why

The Mac said the app was **"damaged."** It isn't. Two separate things are going on:

**1. The "damaged" popup.** Apple is a bouncer. Chrome puts an invisible *"came from the internet"*
sticker on every download; the bouncer sees it and asks whether Apple approves this app. Approval
costs $99/year and we're not paying it, so it's refused — and Mac says "damaged" instead of
"I don't recognise this." Wrong word, fine file.
**Fix:** carry the file over on a **pen drive**. Pen drives can't hold the sticker, so it's wiped in
transit, the bouncer never looks, and it installs normally. Free, no typing.

**2. Auto-updates don't work** (separate problem). Every app is signed, like handwriting. When an
update arrives, Mac checks it's in the same handwriting as the installed app. Ours has no real
handwriting — every build is random scribbles — so Mac sees a mismatch and rejects every update,
forever. Mac does this check itself; no setting of ours turns it off.
**Fix:** make our own signature stamp (free, below). Same handwriting every build → updates apply.
It's *homemade*, not Apple-approved, so it does **not** get past the bouncer — the pen drive is
still needed for the first install.

**Result:** pen drive once. After that, updates arrive by themselves, like Windows.

**Not yet proven (~70% confident):** that Mac accepts the homemade stamp for the update check. That's
exactly what Phase 0 tests, before anything else changes.

---

## Prerequisites

```bash
xcode-select --install    # provides codesign; skip if already installed
node --version            # need v20+
```

## One-time setup

```bash
git clone https://github.com/shubhamsgh10/Bagicha-POS.git
cd Bagicha-POS
git checkout Thermal-Printer
npm ci
```

---

## Phase 0 — the spike

### Step 1 — create the signature stamp

Valid 10 years. The CN is prefixed `Developer ID Application:` **on purpose** — electron-builder only
matches identities against known Apple type names and silently skips anything else.

```bash
cat > /tmp/bagicha-codesign.cnf <<'EOF'
[ req ]
distinguished_name = dn
x509_extensions    = v3_codesign
prompt             = no

[ dn ]
CN = Developer ID Application: Bagicha POS (SELFSIGNED)
O  = Bagicha
C  = IN

[ v3_codesign ]
basicConstraints = critical,CA:false
keyUsage         = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /tmp/bagicha-signing.key \
  -out    /tmp/bagicha-signing.crt \
  -config /tmp/bagicha-codesign.cnf

openssl pkcs12 -export \
  -inkey /tmp/bagicha-signing.key \
  -in    /tmp/bagicha-signing.crt \
  -out   ~/bagicha-signing.p12 \
  -name  "Developer ID Application: Bagicha POS (SELFSIGNED)" \
  -passout pass:bagicha
```

### Step 2 — load it into the keychain

```bash
security import ~/bagicha-signing.p12 \
  -k ~/Library/Keychains/login.keychain-db \
  -P bagicha \
  -T /usr/bin/codesign
```

Let `codesign` use the key without a popup on every build. **Replace `YOUR_MAC_PASSWORD`** with the
Mac login password — this is one of the few steps a human must type:

```bash
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k 'YOUR_MAC_PASSWORD' ~/Library/Keychains/login.keychain-db
```

**Checkpoint — the stamp must be listed:**

```bash
security find-identity -v -p codesigning
```

Expect a line containing `Developer ID Application: Bagicha POS (SELFSIGNED)`.
Not listed → stop, nothing downstream will work.

### Step 3 — build

```bash
npm run pack:mac
```

`pack:mac` (unlike `pack:win`) does **not** force `CSC_IDENTITY_AUTO_DISCOVERY=false`, so it picks the
stamp up from the keychain on its own.

> **If it fails with "cannot find valid identity":** this is the known risk that electron-builder
> rejects a non-Apple certificate name. Fall back to an `afterSign` hook running
> `codesign --deep --force --sign "Developer ID Application: Bagicha POS (SELFSIGNED)"` on the `.app`
> before packaging. Ask Claude to wire it.

### Step 4 — verify the signature is real, not ad-hoc

```bash
codesign -dv --verbose=4 "release/mac-arm64/Bagicha POS.app" 2>&1 | grep -E "Authority|Signature|Identifier"
```

- **Want:** an `Authority=Developer ID Application: Bagicha POS (SELFSIGNED)` line.
- **Bad:** `Signature=adhoc` — means the stamp wasn't used and auto-update will still fail.

**This next one is the make-or-break check:**

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Bagicha POS.app"
```

Silence (exit 0) = pass. If it complains **`not trusted`** / `CSSMERR_TP_NOT_TRUSTED`, the cert must
be marked trusted system-wide. **This modifies the Mac — ask before running:**

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain /tmp/bagicha-signing.crt
```

### Step 5 — install and launch

Locally built, so it was never downloaded and has no quarantine sticker — expect **no "damaged"
dialog**. If one appears anyway, that's a finding worth reporting.

```bash
hdiutil attach "release/Bagicha POS-1.0.14-arm64.dmg"
cp -R "/Volumes/Bagicha POS 1.0.14-arm64/Bagicha POS.app" /Applications/
hdiutil detach "/Volumes/Bagicha POS 1.0.14-arm64"
open "/Applications/Bagicha POS.app"
```

### Step 6 — the actual test: does an update apply?

Bump the version, rebuild with the **same** stamp, publish as a pre-release, and let the running app
find it. `desktop/updater.ts` checks 15s after launch, then every 6h.

```bash
npm version 1.0.15 --no-git-tag-version
npm run pack:mac
gh release create v1.0.15-spike --prerelease --title "1.0.15 spike" \
  "release/Bagicha POS-1.0.15-arm64.dmg" \
  "release/Bagicha POS-1.0.15-arm64-mac.zip" \
  release/latest-mac.yml
```

Watch the log — `desktop/updater.ts` logs every updater event via `electron-log`:

```bash
tail -f ~/Library/Logs/Bagicha\ POS/main.log
```

| Log line | Meaning |
|---|---|
| `[updater] downloaded:` | **PASS.** The whole premise works. Quit the app; it installs. |
| `Could not get code signature for running application` | Squirrel rejected the stamp → premise fails |
| `not trusted` / `CSSMERR_TP_NOT_TRUSTED` | needs the trust step in Step 4 |

**Clean up the spike release afterwards:** `gh release delete v1.0.15-spike --yes`

---

## If Phase 0 passes → Phase 1

Updates must be signed with the **same certificate** as the installed app, so CI needs it too.

```bash
base64 -i ~/bagicha-signing.p12 | pbcopy   # now on the clipboard
```

- GitHub secrets: `CSC_LINK` (the base64 above) and `CSC_KEY_PASSWORD` (`bagicha`).
- `.github/workflows/release.yml` → `release-mac`: drop `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, pass
  `CSC_LINK` + `CSC_KEY_PASSWORD` instead. Replace the stale "right-click → Open" header comment.
- Port the `release-mac` job to `main` — **it only exists on `Thermal-Printer`**, so a release tagged
  off `main` today produces no Mac build at all.
- Update `CLAUDE.md`'s "Deployment modes" bullet: it says the mac build is "unsigned/ad-hoc-signed…
  first launch needs a right-click → Open past Gatekeeper". Both halves are wrong.

**Keep `~/bagicha-signing.p12` safe and backed up.** See the warning below.

## If Phase 0 fails

Not a disaster — the pen drive still works, you just keep hand-delivering each release. Do the
housekeeping anyway (port the mac job to `main`, fix the stale comment), and revisit the $99
Developer ID, which solves both problems properly and permanently.

---

## Delivering to the client

Download the CI-built dmg → copy to a **pen drive** → install from the pen drive on his Mac. The
sticker never survives the trip. Every release after that arrives by auto-update on its own.

## ⚠️ Don't lose the certificate

macOS matches updates against the **exact** certificate. If `~/bagicha-signing.p12` is lost, changed,
or expires, **auto-update silently stops** and every Mac needs a manual reinstall to recover. Back it
up somewhere you'll still have in 10 years.

## What this does *not* buy you

Every **new** Mac still needs a pen-drive install. Only a paid Apple Developer ID + notarization
makes a plain browser download work — that's the $99/year we declined.

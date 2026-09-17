# بناء البيت — House Build Manager

PWA for tracking every cost and document of one house build, shared by two users with equal access. Arabic RTL UI, TypeScript + Vite, Supabase for data, Google Drive for files, Claude API for document reading.

Built from the spec doc "House Build Manager — Build Spec". This release covers **Phases 1–3**: MVP, variations, printable vendor statement, retention, warranties and the site photo log.

## Try it first (demo mode)

With no `.env.local`, the app runs in demo mode: data stays in the browser on this device, files are stored locally, no login.

```powershell
npm install
npm run dev
```

Open the printed URL. Run the tests with `npm test` (financial engine, all amounts in fils).

## Setup for real use

### 1. GitHub repo
1. Create a new repo (e.g. `bina`) and push this folder to `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. The site will be `https://<user>.github.io/<repo>/`.

### 2. Supabase (same project as Masareef)
1. SQL Editor → run, in order:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_security_audit.sql` (enable the **pg_cron** extension first: Database → Extensions)
   - `supabase/migrations/004_phase3.sql`
2. Authentication → URL Configuration → add the Pages URL to **Redirect URLs**.
3. Authentication → Email Templates → **Magic Link**: add the code so login also works inside the home-screen app:
   ```html
   <p>أو اكتب هذا الرمز في التطبيق: <strong>{{ .Token }}</strong></p>
   ```
4. Both of you open the site and sign in once (you will see "حسابك غير مضاف للمشروع" — expected).
5. Edit the two emails in `supabase/migrations/003_seed.sql`, run it, then reopen the app.

All tables are prefixed `hb_` so they don't collide with Masareef or the invoice app in the same project.

### 3. Google Cloud (Drive)
1. Enable **Google Drive API** and **Google Picker API**.
2. OAuth consent screen: add scope `.../auth/drive.file`; add your father's Gmail as a **test user**.
3. Credentials → OAuth client ID (Web): add the Pages origin (`https://<user>.github.io`) and `http://localhost:5173` to **Authorized JavaScript origins**.
4. Credentials → API key: restrict to Picker API and your origins.
5. Note the **project number** (Cloud console home) — this is the App ID.

### 4. GitHub secrets
Settings → Secrets and variables → Actions → add:

| Secret | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_GOOGLE_CLIENT_ID` | OAuth client ID |
| `VITE_GOOGLE_API_KEY` | Picker API key |
| `VITE_GOOGLE_APP_ID` | Cloud project number |

Push to `main` (or run the workflow manually). It runs the tests, builds, and deploys.

### 5. In the app (each device)
1. Settings → **مجلد Google Drive** → on Ahmed's phone choose "إنشاء مجلد جديد", then share that folder with your father as **Editor** from Google Drive. On your father's phone choose "اختيار مجلد موجود" and pick the shared folder (tab 2 in the picker).
2. Settings → **مفتاح Claude API** → paste a key from console.anthropic.com. Stored on that device only.
3. Safari/Chrome → Add to Home Screen.

## Where things live

```
src/
  engine.ts            pure money logic (fils) + engine.test.ts
  money.ts, dates.ts   formatting (Latin digits, BD with 3 decimals)
  strings.ts           every Arabic label; enum key → label
  db/store.ts          local cache (IndexedDB), offline outbox, conflict check, realtime, soft delete + cascade
  documents.ts         hash → duplicate check → compress → upload queue to Drive
  drive.ts             Google sign-in, Picker, multipart upload
  ai.ts                Claude extraction + learning from corrections
  app.ts               hash router, bottom nav, add sheet
  screens/             one file per area
supabase/migrations/   schema, RLS, audit trigger, realtime, 30-day purge, seed
public/                manifest, service worker, icons
```

## Decisions made during the build (differ slightly from the spec)

- **Table names** are `hb_*` instead of bare names (shared Supabase project).
- **Drive files** go into the one shared folder (no per-vendor subfolders); names follow `YYYY-MM-DD_<vendor>_<type>_<amount>.<ext>`. With the `drive.file` scope, the second user's app can't reliably write into subfolders the first user's app created.
- **In-app preview** uses Drive's embed viewer, which works with each person's own Google login regardless of app scope.
- **Statuses are derived, not stored:** `fully_paid` and all milestone statuses come from payments. Stored commitment status is only `estimated / approved / cancelled`; milestones store a `marked_due` flag.
- **Cancelled commitments** keep what was already paid in the totals (money spent), and drop the unpaid part from the forecast.
- **Cascade soft delete** runs in the app (so it also works offline). Restoring a parent restores children deleted at the same moment.
- **Login** accepts the magic link or the 6-digit code from the same email.
- **Contingency** is 10% of remaining unpaid amounts (open question in the spec; change the formula in `engine.ts → projectFigures` if you prefer 10% of total).

## Phase 3 features

- **Retention:** set "نسبة المحتجز" on a contract. Each payment then suggests the held amount (`paid × pct ÷ (100 − pct)`), the commitment page shows the total held, and "تسجيل الإفراج" records the release.
- **Warranties:** item, vendor/contract, start date, duration, certificate. Home shows an alert 60 days before expiry.
- **Site log:** dated visits with stage, note and photos (stored as `site_photo` documents in Drive), shown as a timeline grouped by stage.

## Not in this release

Web Push notifications. They need a server-side sender (a Supabase Edge Function + VAPID keys + a cron job). Until then, alerts appear inside the app: due milestones, missing proof, expiring warranties, and the badge for the other user's activity.

# Recruitimation — End-to-End Test Guide

A walkthrough for running the full Recruitimation workflow. The app is **already deployed to the cloud**, so for the core test you don't install anything — you just need a web browser (Chrome recommended).

**Live URLs**
- **App (use this):** https://frontend-production-5ab2.up.railway.app
- **API (behind the scenes):** https://backend-production-a0d3.up.railway.app

> What the tool does: it takes job candidates (pasted, or scraped from Indeed/LinkedIn by a browser extension), scores them with AI for *fit* and *willingness to take the job*, lets you swipe through them (keep / pin / skip), drafts outreach messages, and logs everything for an applicant-tracking system (ATS).

---

## Part 1 — Test the full workflow in the live app (no install, ~10 min)

Do these in order. Each step says what you should see if it's working.

### Step 1 — Open the app and view jobs
1. Go to **https://frontend-production-5ab2.up.railway.app**
2. You land on the **Jobs** page. There should already be one job: **Forklift Operator**.

✅ Success: you see the Forklift Operator job card.

### Step 2 — Create your own job
1. Click **New Job** (or the "+" button).
2. Fill in something like:
   - **Title:** Warehouse Associate
   - **Description:** Pick and pack orders in a distribution center. Lift up to 40 lbs, operate pallet jacks, reliable attendance. Day shift. Will train.
   - **Location:** Columbus, OH
   - **Pay range:** $16-18/hr
3. Save.

✅ Success: the new job appears in the list.

### Step 3 — Paste & Parse a candidate (the AI scoring core)
This is the fastest way to see the AI work — no extension needed.

1. Go to the **Paste / Parse** page (in the top nav, the `/parse` view).
2. On the left, either pick your job or paste the job description.
3. On the right, paste a candidate profile. You can use this sample:

```
Marcus Bell
Columbus, OH 43215 | (614) 555-0182 | marcus.bell@email.com

Work Experience:
Assembly Technician - Honda Manufacturing, Marysville OH - Mar 2022 to Present
- Assembled subcomponents on the line, met daily quota, operated torque tools
Warehouse Associate - Amazon, Etna OH - Jun 2020 to Feb 2022
- Picked and packed orders, lifted up to 50 lbs, forklift certified

Skills: hand tools, torque wrench, forklift, quality inspection, teamwork
Last active: 3 days ago
```

4. Click **Parse & Score**.

> ⏳ **This takes up to ~2 minutes.** The free AI tier we're using is slow. This is a known limitation, not a bug. Be patient — the result will appear.

✅ Success: you get a candidate card showing extracted name/phone/email, a **Match score**, a **Willingness score**, a one-line summary, risk flags, and parsed job history + skills.

### Step 4 — Add candidates to a job (simulating the extension)
The candidates that came in from Indeed already live under the **Forklift Operator** job (ID `4db74ca3-4da9-45cf-92d2-8d3b857a8252`). Open that job to see them. If it's empty, the optional extension test in Part 2 adds some, or just use the Paste & Parse results.

✅ Success: the Forklift Operator job lists scored candidates, sorted by match score.

### Step 5 — Swipe through candidates
1. Open a job that has candidates, then open the **Swipe Deck**.
2. For each candidate card you can **Keep**, **Pin** (save for later, with an optional note/date), or **Skip**.
3. Swipe/click through a few.

✅ Success: cards advance as you decide; a progress indicator moves.

### Step 6 — Review the Results grid
1. Open the **Results** view for that job.
2. Filter by **Keep / Pin / Skip / All**.
3. Click a candidate to see full detail (scores, history, and the PDF viewer if a résumé was uploaded).

✅ Success: your decisions from Step 5 are reflected here.

### Step 7 — Draft and "send" outreach
1. On a **Keep** candidate's detail page, click to **generate an outreach draft**.

> ⏳ Also AI-generated, so give it up to a minute.

2. Edit the message if you like, then click **Looks good / Send**.
3. Note: this **does not actually message the person** — it marks the message as sent and logs it. (Real sending is manual, by design, so contact credits aren't wasted.)

✅ Success: the draft appears, is editable, and after sending shows a sent timestamp.

### Step 8 — Check the ATS log + export
1. The Keep + send action auto-logs the candidate to the ATS as "submitted".
2. Find the **Export CSV** action (ATS) and download the log.

✅ Success: a CSV downloads with the candidate/job/stage rows.

**That's the full end-to-end loop:** job → candidate in → AI scoring → swipe decision → outreach → ATS log.

---

## Part 2 — (Optional) Test the browser extension

The extension is the part that scrapes candidates off Indeed/LinkedIn. You can test its scraping logic **without an Indeed employer account** using the included test fixture. This part needs the code.

### Get the code
```bash
git clone https://github.com/onghaig/recruitimation.git
cd recruitimation
```

### A) Test the scraper with the fixture (no Indeed needed)
1. In Chrome, open this file (adjust the path to where you cloned it):
   ```
   file:///path/to/recruitimation/extension/test/indeed-fixture.html
   ```
2. Click **"1. Scrape this page"** → you should see 3 candidates extracted as JSON.
3. In the job-ID box paste `4db74ca3-4da9-45cf-92d2-8d3b857a8252`, then click **"2. POST to /api/ingest"**.
4. Open the app → **Forklift Operator** job → the 3 new candidates appear and score within ~30 seconds.

✅ Success: scraped candidates show up scored in the dashboard.

### B) Load the actual extension into Chrome
1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** → select the `extension/` folder.
4. Click the Recruitimation icon → set the API URL to
   `https://backend-production-a0d3.up.railway.app` → **Save**.
5. A green **Connected** dot means the extension reaches the backend.

> The extension only auto-scrapes when you're on a real `employers.indeed.com/.../applicants` page. Without an employer account, the **fixture in step A** is how you verify it.

---

## Known quirks (so they're not surprises)
- **AI steps are slow (~1–2 min).** We're on a free AI tier. Scoring and outreach drafting both take time. The app is working; just wait.
- **The app is wide open.** There's no login yet — anyone with the URL can use it. Fine for this test; see the note below.
- **No real messages are sent.** Outreach "send" only logs; you message the candidate yourself on the platform.

---

## Appendix — Running it all locally (only if you want your own copy)
Not needed for the test above, but if you want to run the backend yourself:

```bash
git clone https://github.com/onghaig/recruitimation.git
cd recruitimation
docker compose up -d                 # starts Postgres + Redis

cd backend
cp .env.example .env                 # then fill in NVIDIA_API_KEY and R2_* keys
npm install
npm run db:push                      # create the database tables
npm run dev                          # API on http://localhost:3000

cd ../frontend
npm install
npm run dev                          # app on http://localhost:5173
```
The backend process also runs the AI scoring worker, so you don't need a separate worker command.

---

*Questions? The whole thing is one app: a React frontend, a Node/Fastify backend with a Postgres database and a Redis queue, and a Chrome extension — all deployed on Railway.*

# Recruitimation

> AI-powered candidate screening for light industrial staffing.

Ingests applicants from Indeed / LinkedIn via a Chrome extension, scores them with embeddings + Claude, and presents them in a swipe-style review dashboard.

---

## Architecture

```
Chrome Extension  →  POST /api/ingest  →  Backend (Fastify + Prisma)
                                                │
                                         BullMQ queue
                                                │
                                      AI Scoring Worker
                                       ├── OpenAI embeddings (match score)
                                       └── Claude (willingness score + summary)
                                                │
                                         PostgreSQL + R2
                                                │
                                      React frontend (swipe deck)
```

---

## Quick Start

### Prerequisites
- Node 20+
- Docker (for Postgres + Redis)

### 1. Start infrastructure

```bash
docker-compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env        # fill in API keys
npm install
npm run db:push             # apply schema to Postgres
npm run dev                 # API on :3000
```

In a second terminal:
```bash
npm run worker              # BullMQ scoring worker
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                 # Vite on :5173
```

### 4. Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the extension and set the API URL to `http://localhost:3000`

---

## Phase 1 — Paste & Parse

Visit **http://localhost:5173/parse** to paste a candidate profile and validate AI scoring without the extension.

---

## Environment Variables

| Key | Description |
|-----|-------------|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `OPENAI_API_KEY` | For text-embedding-3-small |
| `ANTHROPIC_API_KEY` | For Claude (scoring + outreach) |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name (default: `recruiting-pdfs`) |

---

## Project Structure

```
recruitimation/
├── backend/            Node.js + Fastify API + BullMQ worker
│   ├── prisma/         Database schema
│   └── src/
│       ├── routes/     API endpoints
│       ├── workers/    BullMQ scoring worker
│       ├── ai/         Embeddings, scoring, draft generation
│       └── storage/    Cloudflare R2
├── frontend/           React + Vite + Tailwind
│   └── src/
│       ├── views/      SwipeDeck, ResultsGrid, OutreachFlow, JobManager, PasteAndParse
│       ├── components/ CandidateCard, ScoreChip, PdfViewer
│       └── api/        API client
└── extension/          Chrome Manifest V3
    ├── content/        indeed.js, linkedin.js
    ├── popup/          Extension popup UI
    ├── interceptor.js  LinkedIn XHR/fetch proxy (page context)
    └── background.js   Service worker
```

---

## Build Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Paste & Parse MVP — validate AI scoring |
| 2 | ✅ Done | Core API, DB schema, swipe deck |
| 3 | ✅ Done | Chrome extension (Indeed + LinkedIn) |
| 4 | ✅ Done | Outreach draft + confirm flow |
| 5 | ✅ Done | ATS logging + CSV export |
| 6 | 🔲 Next | LinkedIn DOM hardening, pin remind cron |
| 7 | 🔲 Next | PCF PDF generation |
| 8 | 🔲 Next | Auth (Clerk / Auth.js) |

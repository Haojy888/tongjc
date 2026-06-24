# TRAE Handoff Notes

## Project

TongJC Chat is a React + Vite web app for AI-assisted relationship chat analysis.

Live demo:

- https://www.tongjcchat.xyz/
- https://tongjc111.vercel.app/

Repository:

- https://github.com/Haojy888/tongjc

## What Is Included

- React/Vite frontend in `src/`
- Vercel Python API in `api/index.py`
- Analysis core in `api/tjc_core.py`
- Local knowledge base in `api/tjc-knowledge-clean.json`
- Vercel config in `vercel.json`
- Environment template in `.env.example`

Excluded from the ZIP:

- `node_modules/`
- `dist/`
- `.git/`
- `.env`
- Python cache files
- Real API keys

## Main Features

- Paste a message and analyze relationship signal strength.
- Import WeChat chat history from pasted text or uploaded txt/csv/json/html files.
- Combine imported chat context, manual background, and latest message.
- Show context trend, action decision, signal breakdown, and reply suggestions.
- Switch runtime AI provider between DeepSeek and OpenAI.
- Deploy frontend and backend together on Vercel.

## Local Development

Install dependencies:

```bash
npm install
```

Start frontend:

```bash
npm run dev
```

Local frontend:

```text
http://127.0.0.1:5173/
```

The current local Vite config proxies API routes to:

```text
http://127.0.0.1:8765/
```

For local backend development, use the original local server file:

```text
C:\Users\Haojy\tjc-server.py
```

The Vercel API version is already included in this project under `api/`.

## Production Deployment

The project is configured for Vercel.

Required or recommended environment variables:

```bash
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.5
OPENAI_API_URL=https://api.openai.com/v1/responses
```

On Vercel, frontend requests are sent to:

```text
/api/analyze
/api/frameworks
/api/search
/api/api-config
```

## Domain

Current custom domain:

```text
www.tongjcchat.xyz
tongjcchat.xyz
```

DNS records used:

```text
@     A       216.198.79.1
www   CNAME   48bf83c07bd7ae8c.vercel-dns-017.com
```

## Important Security Notes

Do not commit real API keys.

The user previously pasted API keys during development. For production use, rotate old keys and set new keys only in Vercel environment variables or a secure secret manager.

## Suggested Next TRAE Tasks

1. Improve mobile layout for the right-side analysis cards.
2. Add persistent imported chat sessions with local storage.
3. Add better WeChat export format recognition.
4. Add screenshots and session IDs for TRAE competition submission.
5. Refine the product proposal HTML page for the TRAE AI creativity contest.
6. Add loading/error states for Vercel API cold starts.
7. Add privacy copy before importing chat records.

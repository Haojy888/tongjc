# Tong Jincheng Perspective

React + Vite frontend for a relationship-message analysis tool inspired by the tong-jincheng-perspective skill.

## One-click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Haojy888/tongjc&project-name=tongjc&repository-name=tongjc&env=AI_PROVIDER,DEEPSEEK_API_KEY,DEEPSEEK_MODEL,OPENAI_API_KEY,OPENAI_MODEL&envDescription=Configure%20AI%20provider%20keys.%20Use%20AI_PROVIDER%3Ddeepseek%20or%20openai.&envLink=https%3A%2F%2Fgithub.com%2FHaojy888%2Ftongjc%2Fblob%2Fmain%2F.env.example)

Vercel will build the Vite frontend and deploy the included Python API under `/api`.

Recommended environment variables:

```bash
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_MODEL=deepseek-v4-flash

# Optional OpenAI provider
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5.5
```

## Run

```bash
npm install
npm run dev
```

The frontend runs at `http://127.0.0.1:5173/`.

During local development, API requests are proxied to `http://127.0.0.1:8765/`. Start the backend service before using analysis features.

In production on Vercel, requests go to `/api/analyze`, `/api/frameworks`, `/api/search`, and `/api/api-config`.

If you use a separate backend, set:

```bash
VITE_API_BASE_URL=https://your-api.example.com
```

## Build

```bash
npm run build
```

## Notes

Do not commit real API keys. Configure provider keys from the in-app API settings panel or environment variables on your backend service.

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_PREFIX = API_BASE_URL || (import.meta.env.PROD ? '/api' : '');

function apiPath(path) {
  return `${API_PREFIX}${path}`;
}

export async function analyzeMessage({ message, context, background }) {
  const response = await fetch(apiPath('/analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      context: context.slice(-80),
      background
    })
  });

  if (!response.ok) {
    throw new Error(`Analyze failed: ${response.status}`);
  }

  return response.json();
}

export async function fetchFrameworks() {
  const response = await fetch(apiPath('/frameworks'));
  if (!response.ok) {
    throw new Error(`Frameworks failed: ${response.status}`);
  }
  return response.json();
}

export async function searchKnowledge(query) {
  const response = await fetch(apiPath(`/search?q=${encodeURIComponent(query)}`));
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchApiConfig() {
  const response = await fetch(apiPath('/api-config'));
  if (!response.ok) {
    throw new Error(`API config failed: ${response.status}`);
  }
  return response.json();
}

export async function saveApiConfig(config) {
  const response = await fetch(apiPath('/api-config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });

  if (!response.ok) {
    throw new Error(`Save API config failed: ${response.status}`);
  }

  return response.json();
}

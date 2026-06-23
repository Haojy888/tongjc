export async function analyzeMessage({ message, context, background }) {
  const response = await fetch('/analyze', {
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
  const response = await fetch('/frameworks');
  if (!response.ok) {
    throw new Error(`Frameworks failed: ${response.status}`);
  }
  return response.json();
}

export async function searchKnowledge(query) {
  const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchApiConfig() {
  const response = await fetch('/api-config');
  if (!response.ok) {
    throw new Error(`API config failed: ${response.status}`);
  }
  return response.json();
}

export async function saveApiConfig(config) {
  const response = await fetch('/api-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });

  if (!response.ok) {
    throw new Error(`Save API config failed: ${response.status}`);
  }

  return response.json();
}

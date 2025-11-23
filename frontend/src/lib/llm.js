export async function callLLM(apiUrl, messages, model = 'doubao-seed-1-6-251015', service = 'volc') {
  if (!apiUrl) throw new Error('API URL is required');
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ service, model, messages, temperature: 0.3, stream: false, enable_thinking: false })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API Error: ${response.status} - ${err}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

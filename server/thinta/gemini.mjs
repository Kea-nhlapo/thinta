// One structured Gemini call for every Thinta agent, the same way describeImages and lesson-jobs call it:
// fetch to generateContent with a JSON schema, falling through busy or retired models. Server-side only.

export const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest'];
const tryNextModel = (status, detail) => [0, 429, 500, 503].includes(status) || ([400, 404].includes(status) && /no longer available|not found|not supported/i.test(detail));

export class GeminiError extends Error {}

// parts: Gemini content parts ({text} or {inlineData:{mimeType,data}}). Returns the parsed JSON object.
export async function geminiJSON({ apiKey, parts, schema, models = MODELS, temperature = 0.2, timeoutMs = 45000, fetchImpl = fetch }) {
  if (!apiKey) throw new GeminiError('Set GEMINI_API_KEY to run Thinta live.');
  let last = 'Gemini did not answer.';
  for (const model of models) {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature } }),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(error => ({ ok: false, status: 0, text: async () => error.message }));
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      last = `${model}: ${response.status} ${detail.slice(0, 200)}`;
      if (tryNextModel(response.status, detail)) continue;
      throw new GeminiError(last);
    }
    try {
      const data = await response.json();
      return JSON.parse(data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}');
    } catch (error) { last = `${model}: unreadable JSON`; continue; }
  }
  throw new GeminiError(last);
}

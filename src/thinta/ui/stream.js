// NDJSON reading for POST /api/thinta/run. Pure and DOM-free so it runs under node --test.

// Splits text chunks into lines, keeping a partial line until its newline arrives.
export function createLineParser(onEvent) {
  let buffer = '';
  const emit = line => {
    const text = line.trim();
    if (!text) return;
    try { onEvent(JSON.parse(text)); } catch { onEvent({ type: 'bad-line', line: text.slice(0, 200) }); }
  };
  return {
    push(chunk) {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) { emit(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    },
    end() { const rest = buffer; buffer = ''; emit(rest); },
  };
}

// Reads a fetch Response body incrementally and calls onEvent for every event as it arrives.
export async function readNdjson(response, onEvent) {
  const parser = createLineParser(onEvent);
  const decoder = new TextDecoder();
  if (!response.body?.getReader) { parser.push(await response.text()); parser.end(); return; }
  const reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}

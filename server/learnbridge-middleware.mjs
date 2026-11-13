// Serves LearnBridge's free AI routes inside the Vite dev/preview server:
// translation (NLLB), voices (OmniVoice), transcription (Whisper / isiZulu W2V-BERT),
// YouTube captions and ASL signing motion (sign.mt).
import gateway from './learnbridge-gateway.mjs';

const ROUTES = new Set(['/api/translate', '/api/speak', '/api/transcribe', '/api/youtube', '/api/asl', '/api/describe-images']);
const MAX_BODY = 5 * 1024 * 1024;

export function learnBridgeMiddleware(hfToken, geminiKey) {
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!ROUTES.has(path)) return next();
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { res.statusCode = 413; res.end(JSON.stringify({ error: 'Request too large' })); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      // Behind a hosting proxy the phone is on https; keep that, or the gateway's origin check refuses the app itself.
      const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
      const request = new Request(`${proto}://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) });
      const response = await gateway.fetch(request, { HF_TOKEN: hfToken, GEMINI_API_KEY: geminiKey });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = 500; res.end(JSON.stringify({ error: 'LearnBridge request failed.' }));
    }
  };
}

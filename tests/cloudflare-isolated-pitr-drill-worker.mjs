// Isolated Cloudflare Durable Object PITR test fixture.
// No Production data, credentials, KV, SecurityCoordinator or Firebase bindings.
// Configurable auth must be supplied as a Worker secret named PITR_TEST_TOKEN.
const answer = (data, status = 200) => Response.json(data, { status });
export class LanDisposablePitrDrill {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const { action, bookmark } = await request.json();
    const storage = this.ctx.storage;
    if (action === 'baseline') {
      if (await storage.get('testMarker') !== undefined) return answer({ error: 'not-empty' }, 409);
      await storage.put('testMarker', 'before');
      return answer({ marker: 'before', bookmark: await storage.getCurrentBookmark() });
    }
    if (action === 'mutate') {
      if (await storage.get('testMarker') !== 'before') return answer({ error: 'unexpected-state' }, 409);
      await storage.put('testMarker', 'after');
      return answer({ marker: 'after' });
    }
    if (action === 'state') return answer({ marker: await storage.get('testMarker') || null });
    if (action === 'restore' && typeof bookmark === 'string' && /^[0-9a-zA-Z-]{24,130}$/.test(bookmark)) {
      await storage.onNextSessionRestoreBookmark(bookmark);
      this.ctx.abort(); // Intentionally restarts only this disposable object.
      return answer({ unreachable: true });
    }
    return answer({ error: 'bad-request' }, 400);
  }
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export default {
  async fetch(request, env) {
    if (!env.PITR_TEST_TOKEN || !same(request.headers.get('Authorization'), 'Bearer ' + env.PITR_TEST_TOKEN)) {
      return new Response('Unauthorized', { status: 401 });
    }
    // Non-mutating readiness probe: tests the exact deployed secret-bearing
    // Worker version before any Durable Object state is touched.
    if (request.method === 'POST' && new URL(request.url).pathname === '/drill/ready') {
      return answer({ ready: true });
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/drill') {
      return new Response('Not Found', { status: 404 });
    }
    const object = env.ISOLATED_PITR_TEST.get(env.ISOLATED_PITR_TEST.idFromName('DISPOSABLE-ONLY'));
    return object.fetch(new Request('https://test.internal/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: await request.text()
    }));
  }
};

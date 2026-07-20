const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  return Array.from({ length: 8 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function mergeStates(server, client) {
  const merged = { ...server };

  ['zara', 'lune'].forEach(who => {
    if (!client[who] || !server[who]) return;
    const s = server[who], c = client[who];
    merged[who] = {
      ...s,
      earned: Math.max(s.earned || 0, c.earned || 0),
      xp: Math.max(s.xp || 0, c.xp || 0),
      xpSpent: Math.max(s.xpSpent || 0, c.xpSpent || 0),
      cashedOut: Math.max(s.cashedOut || 0, c.cashedOut || 0),
      streak: Math.max(s.streak || 0, c.streak || 0),
      coreDaysTotal: Math.max(s.coreDaysTotal || 0, c.coreDaysTotal || 0),
      completedToday: [...new Set([...(s.completedToday || []), ...(c.completedToday || [])])],
      completedMonth: [...new Set([...(s.completedMonth || []), ...(c.completedMonth || [])])],
      claimedRewards: [...new Set([...(s.claimedRewards || []), ...(c.claimedRewards || [])])],
      pending: [...new Set([...(s.pending || []), ...(c.pending || [])])],
      pendingCashouts: dedupeBy(
        [...(s.pendingCashouts || []), ...(c.pendingCashouts || [])],
        x => `${x.date}-${x.amt}`
      ),
    };
  });

  // Client wins for parent-controlled config
  merged.monthlyBudget = client.monthlyBudget ?? server.monthlyBudget;
  merged.customGigs = client.customGigs ?? server.customGigs;
  merged.customCoreGigs = client.customCoreGigs ?? server.customCoreGigs;
  merged.pins = client.pins ?? server.pins;
  merged.gigOverrides = client.gigOverrides ?? server.gigOverrides;

  // Merge logs — dedupe by time+who+name
  const allLogs = [...(server.log || []), ...(client.log || [])];
  merged.log = dedupeBy(allLogs, e => `${e.ts || e.time}-${e.who}-${e.name}`)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 200);

  return merged;
}

function dedupeBy(arr, key) {
  const seen = new Set();
  return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Create new family
    if (url.pathname === '/api/family/create' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const code = generateCode();
      await env.GS_STATE.put(`family:${code}`, JSON.stringify({
        state: body.state || {},
        updatedAt: Date.now()
      }));
      return json({ code });
    }

    // Get / update family state
    const stateMatch = url.pathname.match(/^\/api\/state\/([A-Z0-9]{4,12})$/);
    if (stateMatch) {
      const code = stateMatch[1].toUpperCase();

      if (request.method === 'GET') {
        const data = await env.GS_STATE.get(`family:${code}`);
        if (!data) return json({ error: 'Family not found' }, 404);
        return json(JSON.parse(data));
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        const existing = await env.GS_STATE.get(`family:${code}`);
        if (!existing) return json({ error: 'Family not found' }, 404);

        const existingData = JSON.parse(existing);
        const clientLastSync = body.lastSyncedAt || 0;
        const serverUpdatedAt = existingData.updatedAt || 0;

        // If server has been updated since client last synced, merge
        const stateToStore = serverUpdatedAt > clientLastSync + 1000
          ? mergeStates(existingData.state, body.state)
          : body.state;

        const updatedAt = Date.now();
        await env.GS_STATE.put(`family:${code}`, JSON.stringify({ state: stateToStore, updatedAt }));
        return json({ ok: true, updatedAt });
      }
    }

    // Fall through to static assets
    return env.ASSETS.fetch(request);
  }
};

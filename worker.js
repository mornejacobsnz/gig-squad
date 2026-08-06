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

const strOnly = arr => (Array.isArray(arr) ? arr : []).filter(x => typeof x === 'string');
const mergeStrArr = (a, b) => [...new Set([...strOnly(a), ...strOnly(b)])];

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
      hunger: Math.min(s.hunger ?? 100, c.hunger ?? 100),
      lastHungerUpdate: s.lastHungerUpdate || c.lastHungerUpdate || '',
      coreDaysTotal: Math.max(s.coreDaysTotal || 0, c.coreDaysTotal || 0),
      coreDaysThisPeriod: Math.max(s.coreDaysThisPeriod || 0, c.coreDaysThisPeriod || 0),
      budgetDoneThisPeriod: !!(s.budgetDoneThisPeriod || c.budgetDoneThisPeriod),
      completedToday: mergeStrArr(s.completedToday, c.completedToday),
      completedMonth: mergeStrArr(s.completedMonth, c.completedMonth),
      claimedRewards: mergeStrArr(s.claimedRewards, c.claimedRewards),
      pending: mergeStrArr(s.pending, c.pending),
      pendingCashouts: dedupeBy(
        [...(s.pendingCashouts || []), ...(c.pendingCashouts || [])],
        x => `${x.date}-${x.amt}`
      ),
    };
  });

  // Client wins for parent-controlled config
  merged.monthlyBudget = client.monthlyBudget ?? server.monthlyBudget;
  merged.customGigs = mergeById(server.customGigs, client.customGigs);
  merged.customCoreGigs = mergeById(server.customCoreGigs, client.customCoreGigs);
  merged.pins = client.pins ?? server.pins;
  merged.gigOverrides = { ...(server.gigOverrides || {}), ...(client.gigOverrides || {}) };
  merged.corePeriodUnlockThreshold = client.corePeriodUnlockThreshold ?? server.corePeriodUnlockThreshold;
  merged.monthStartDay = client.monthStartDay ?? server.monthStartDay;
  merged.lastMonthReset = client.lastMonthReset ?? server.lastMonthReset;

  // Merge logs — dedupe by time+who+name
  const allLogs = [...(server.log || []), ...(client.log || [])];
  merged.log = dedupeBy(allLogs, e => `${e.ts || e.time}-${e.who}-${e.name}`)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 200);

  return merged;
}

function mergeById(a, b) {
  const m = new Map();
  [...(a || []), ...(b || [])].forEach(g => m.set(g.id, g));
  return [...m.values()];
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

        // Always merge custom gig arrays — additions must survive regardless of sync timing
        stateToStore.customGigs = mergeById(existingData.state.customGigs, stateToStore.customGigs);
        stateToStore.customCoreGigs = mergeById(existingData.state.customCoreGigs, stateToStore.customCoreGigs);

        const updatedAt = Date.now();
        await env.GS_STATE.put(`family:${code}`, JSON.stringify({ state: stateToStore, updatedAt }));
        return json({ ok: true, updatedAt, state: stateToStore });
      }
    }

    // Device-level auto-backup (upsert, no family code needed)
    const deviceMatch = url.pathname.match(/^\/api\/device\/([a-z0-9_-]{8,64})$/i);
    if (deviceMatch) {
      const id = deviceMatch[1];
      if (request.method === 'GET') {
        const data = await env.GS_STATE.get(`device:${id}`);
        if (!data) return json({ error: 'Not found' }, 404);
        return json(JSON.parse(data));
      }
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => ({}));
        if (!body.state) return json({ error: 'No state' }, 400);
        await env.GS_STATE.put(`device:${id}`, JSON.stringify({ state: body.state, updatedAt: Date.now() }), { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true });
      }
    }

    // Fall through to static assets
    return env.ASSETS.fetch(request);
  }
};

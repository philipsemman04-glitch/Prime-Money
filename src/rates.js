// USD -> NGN exchange rate. The admin can pin a fixed rate; otherwise a live
// rate is fetched and cached in the settings table for a few hours.
const LIVE_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_MS = 1000 * 60 * 60 * 6;

async function fetchLiveNgnRate() {
  const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Rate API returned ${res.status}`);
  const data = await res.json();
  const rate = Number(data?.rates?.NGN);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Rate API returned no NGN rate');
  return rate;
}

async function getNgnRate(settings, { fetchLive = fetchLiveNgnRate } = {}) {
  const manual = Number(await settings.get('ngn_rate_manual'));
  if (manual > 0) return { rate: manual, source: 'manual', updatedAt: await settings.get('ngn_rate_manual_at') };

  const cached = Number(await settings.get('ngn_rate_live'));
  const cachedAt = await settings.get('ngn_rate_live_at');
  if (cached > 0 && Date.now() - Date.parse(cachedAt) < CACHE_MS) {
    return { rate: cached, source: 'live', updatedAt: cachedAt };
  }
  try {
    const rate = await fetchLive();
    const now = new Date().toISOString();
    await settings.set('ngn_rate_live', String(rate));
    await settings.set('ngn_rate_live_at', now);
    return { rate, source: 'live', updatedAt: now };
  } catch {
    // Live lookup failed: fall back to the last known rate, however old.
    return cached > 0 ? { rate: cached, source: 'live', updatedAt: cachedAt } : { rate: null, source: 'none', updatedAt: null };
  }
}

module.exports = { getNgnRate };

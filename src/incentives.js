// Incentives: rewards the admin sets up, with progress worked out from what
// members already log (scouting, goals, income). Pure helpers; routes.js
// does the storage and notifications.

// What an incentive can be measured on. `money` targets are stored in cents.
const METRICS = {
  scout_days: { label: 'Days hitting the scouting minimum', unit: 'days' },
  scout_streak: { label: 'Days in a row hitting the scouting minimum', unit: 'days in a row' },
  messages: { label: 'Scouting messages sent', unit: 'messages' },
  comments: { label: 'Scouting comments', unit: 'comments' },
  posts: { label: 'Social media posts', unit: 'posts' },
  responses: { label: 'Responses received', unit: 'responses' },
  podcasts: { label: 'Podcasts watched', unit: 'podcasts' },
  goals_done: { label: 'Goals completed', unit: 'goals' },
  income: { label: 'Income made', unit: 'USD', money: true },
  manual: { label: "No — I'll award it myself", unit: '' },
};

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Months (YYYY-MM) that a date range touches.
function monthsBetween(start, end) {
  const out = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); ) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return out;
}

// Longest run of consecutive days in a sorted list of YYYY-MM-DD dates.
function longestRun(days) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...new Set(days)].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// Progress of one member towards one incentive, from their data inside its dates.
//   scouting: the member's scouting entries; goals: their goals; transactions: theirs.
//   met(entry) says whether a scouting entry hit the daily minimum.
function progressOf(inc, { scouting = [], goals = [], transactions = [] }, met) {
  const inRange = (d) => d && d >= inc.start && d <= inc.end;
  const days = scouting.filter((e) => inRange(e.date));
  const sum = (f) => days.reduce((s, e) => s + (f(e) || 0), 0);
  switch (inc.metric) {
    case 'scout_days':
      return days.filter(met).length;
    case 'scout_streak':
      return longestRun(days.filter(met).map((e) => e.date));
    case 'messages':
      return sum((e) => e.dms);
    case 'comments':
      return sum((e) => e.engagements);
    case 'posts':
      return sum((e) => e.posts);
    case 'responses':
      return sum((e) => e.responses);
    case 'podcasts':
      return sum((e) => e.podcasts?.length);
    case 'goals_done': {
      const months = new Set(monthsBetween(inc.start, inc.end));
      return goals.filter((g) => g.done && months.has(g.month)).length;
    }
    case 'income':
      return transactions.filter((t) => t.type === 'income' && inRange(t.date)).reduce((s, t) => s + t.amountCents, 0);
    default:
      return 0; // manual: the admin awards it
  }
}

// How often an incentive can be won: once, every time it's achieved, or once a week (ongoing).
const REPEATS = ['once', 'each', 'weekly'];

// Where a member stands: won, upcoming, missed, in_progress or available.
// Incentives that can be won again stay available (or upcoming/ended) - their wins are counted.
function statusOf(inc, { won, progress, today }) {
  const repeat = inc.repeat && inc.repeat !== 'once';
  if (won && !repeat) return 'won';
  if (today < inc.start) return 'upcoming';
  if (inc.end && today > inc.end) return 'missed';
  if (repeat) return 'available';
  return progress > 0 ? 'in_progress' : 'available';
}

// Monday of the week a day falls in (weeks run Monday to Sunday).
function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

// Clean up an incentive sent by the admin. Returns { incentive } or { error }.
function cleanIncentive(body, today) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const title = str(body?.title);
  const reward = str(body?.reward);
  // What has to be achieved, in the admin's own words.
  const goal = str(body?.goal) || str(body?.description);
  const repeat = REPEATS.includes(body?.repeat) ? body.repeat : 'once';
  // Incentives won again and again are awarded by hand.
  const metric = repeat === 'once' ? body?.metric || 'manual' : 'manual';
  if (!title || title.length > 80) return { error: 'Give the incentive a name (up to 80 characters).' };
  if (!reward || reward.length > 80) return { error: 'Say what the reward is (up to 80 characters).' };
  if (!goal) return { error: 'Write what has to be achieved.' };
  if (goal.length > 300) return { error: 'Keep "what has to be achieved" under 300 characters.' };
  if (!METRICS[metric]) return { error: 'Pick how to track it, or leave it for you to award.' };
  let target = 0;
  if (metric !== 'manual') {
    const n = Number(body?.target);
    if (!Number.isFinite(n) || n <= 0 || n > 1e9) return { error: 'Set a target greater than zero.' };
    target = METRICS[metric].money ? Math.round(n * 100) : Math.round(n);
    if (target <= 0) return { error: 'Set a target greater than zero.' };
  }
  const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const start = body?.start || today;
  // Repeating incentives can keep going with no end date.
  const end = repeat !== 'once' && (body?.noEnd === true || body?.noEnd === 'on' || !body?.end) ? null : body?.end;
  if (!isDay(start)) return { error: 'Pick the start date.' };
  if (end !== null) {
    if (!isDay(end)) return { error: 'Pick the end date.' };
    if (end < start) return { error: 'The end date must be after the start date.' };
    if (repeat === 'once' && Date.parse(end) - Date.parse(start) > 400 * 86400000) return { error: 'An incentive can run for up to about a year.' };
  }
  // Optional cash value of one award, in naira, so totals can be shown.
  let amount = null;
  if (body?.amount !== undefined && body?.amount !== null && body?.amount !== '') {
    amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) return { error: 'The cash value must be a number.' };
  }
  return { incentive: { title, reward, goal, metric, target, start, end, repeat, amount } };
}

module.exports = { METRICS, REPEATS, progressOf, statusOf, cleanIncentive, longestRun, monthsBetween, weekStart };

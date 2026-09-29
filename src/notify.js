// Email notifications through Resend (https://resend.com). Without an API key
// the notifier is disabled and every send is skipped.
const RESEND_URL = 'https://api.resend.com/emails';

function createNotifier({ apiKey, from = 'Team Prime <onboarding@resend.dev>', fetchImpl = fetch } = {}) {
  return {
    enabled: Boolean(apiKey),
    async send({ to, subject, html, text }) {
      if (!apiKey) return { skipped: true };
      const res = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Email service returned ${res.status}: ${detail.slice(0, 300)}`);
      }
      return { sent: true };
    },
  };
}

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatMoney = (cents, currency) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: currency === 'NGN' ? 0 : 2,
  }).format(cents / 100);

const POT_LABELS = { business: 'Business', personal: 'Personal', savings: 'Savings', investment: 'Investment' };

// The email the admin gets when a member sends a fund request.
function fundRequestEmail({ request, member, teamName, reviewUrl }) {
  const cur = request.origCurrency;
  const total = formatMoney(request.origAmountCents, cur);
  const usd = cur !== 'USD' ? ` (≈ ${formatMoney(request.amountCents, 'USD')})` : '';
  const pot = POT_LABELS[request.pot] ?? request.pot;
  const subject = `New fund request: ${total} from ${member.displayName}`;

  const rows = request.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #22304a">${escapeHtml(i.name)}</td><td style="padding:8px 0;border-bottom:1px solid #22304a;text-align:right">${formatMoney(i.price, cur)}</td></tr>`,
    )
    .join('');

  const html = `
  <div style="background:#0a0e16;padding:32px 16px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#eef2f8">
    <div style="max-width:520px;margin:0 auto;background:#121a29;border:1px solid #22304a;border-top:3px solid #e3b448;border-radius:14px;padding:28px">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#e3b448;font-weight:700">${escapeHtml(teamName)}</div>
      <h1 style="font-size:22px;margin:6px 0 4px">New fund request</h1>
      <p style="margin:0 0 20px;color:#8d9ab0">${escapeHtml(member.displayName)} is asking for <b style="color:#eef2f8">${total}</b>${usd} from their <b style="color:#eef2f8">${escapeHtml(pot)}</b> pot.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#eef2f8">${rows}
        <tr><td style="padding:10px 0;font-weight:700">Total</td><td style="padding:10px 0;text-align:right;font-weight:700">${total}</td></tr>
      </table>
      ${request.reason ? `<p style="margin:12px 0 0;color:#8d9ab0;font-style:italic">“${escapeHtml(request.reason)}”</p>` : ''}
      <div style="margin-top:18px;padding:14px;border-radius:10px;background:#0e1420;border:1px solid #22304a;font-size:14px;line-height:1.7">
        <div><span style="color:#8d9ab0">Bank:</span> ${escapeHtml(request.bankName)}</div>
        <div><span style="color:#8d9ab0">Account number:</span> <b>${escapeHtml(request.accountNumber)}</b></div>
        <div><span style="color:#8d9ab0">Account name:</span> ${escapeHtml(request.accountName)}</div>
      </div>
      <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;margin-top:22px;padding:12px 22px;border-radius:10px;background:#e3b448;color:#1a1405;font-weight:700;text-decoration:none">Review request</a>
    </div>
  </div>`;

  const text = [
    `New fund request from ${member.displayName}`,
    `Amount: ${total}${usd} from the ${pot} pot`,
    '',
    ...request.items.map((i) => `- ${i.name}: ${formatMoney(i.price, cur)}`),
    request.reason ? `\nReason: ${request.reason}` : '',
    '',
    `Bank: ${request.bankName}`,
    `Account number: ${request.accountNumber}`,
    `Account name: ${request.accountName}`,
    '',
    `Review it: ${reviewUrl}`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { createNotifier, fundRequestEmail };

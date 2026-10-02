// Email notifications. Two ways to send:
// - Gmail (GMAIL_USER + GMAIL_APP_PASSWORD): can email anyone, no domain needed.
// - Resend (RESEND_API_KEY): without a verified domain it only delivers to the
//   address that owns the Resend account.
// With neither configured, every send is skipped.
const RESEND_URL = 'https://api.resend.com/emails';

function createNotifier({ apiKey, gmailUser, gmailPassword, from, fetchImpl = fetch, transport } = {}) {
  if (gmailUser && gmailPassword) {
    const mailer =
      transport ??
      require('nodemailer').createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailPassword.replace(/\s+/g, '') },
      });
    return {
      enabled: true,
      canEmailAnyone: true,
      async send({ to, subject, html, text }) {
        await mailer.sendMail({ from: from || `Team Prime <${gmailUser}>`, to, subject, html, text });
        return { sent: true };
      },
    };
  }
  from = from || 'Team Prime <onboarding@resend.dev>';
  return {
    enabled: Boolean(apiKey),
    canEmailAnyone: false,
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

const shell = (inner) => `
  <div style="background:#eef1f6;padding:32px 16px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0b1630">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;padding:28px;border-top:4px solid #f2c14e">${inner}</div>
  </div>`;

// Emails a member gets about their own request.
function memberRequestEmail({ kind, request, member, teamName, url }) {
  const cur = request.origCurrency;
  const total = formatMoney(request.origAmountCents, cur);
  const pot = POT_LABELS[request.pot] ?? request.pot;
  const first = String(member.displayName || '').split(' ')[0] || 'there';
  const copy = {
    approved: {
      subject: `Approved: your request for ${total}`,
      heading: 'Your request was approved ✅',
      line: `Good news, ${escapeHtml(first)} — your request for <b>${total}</b> from your ${escapeHtml(pot)} pot has been approved. The money will be sent to ${escapeHtml(request.bankName)} ${escapeHtml(request.accountNumber)}.`,
      color: '#0f9d58',
    },
    paid: {
      subject: `Paid: ${total} has been sent to you`,
      heading: 'Payment sent 💸',
      line: `Hi ${escapeHtml(first)}, your request for <b>${total}</b> has been approved and paid to ${escapeHtml(request.bankName)} ${escapeHtml(request.accountNumber)}. The transfer receipt is attached to your request in the app.`,
      color: '#0f9d58',
    },
    declined: {
      subject: `Declined: your request for ${total}`,
      heading: 'Your request was declined',
      line: `Hi ${escapeHtml(first)}, your request for <b>${total}</b> from your ${escapeHtml(pot)} pot was declined.`,
      color: '#e5484d',
    },
  }[kind];

  const items = request.items.map((i) => `<li>${escapeHtml(i.name)} — ${formatMoney(i.price, cur)}</li>`).join('');
  const note = request.adminNote ? `<p style="margin:16px 0 0;padding:12px 14px;border-radius:10px;background:#f4f6fa"><b>Note from your admin:</b> ${escapeHtml(request.adminNote)}</p>` : '';
  const html = shell(`
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b5821f;font-weight:700">${escapeHtml(teamName)}</div>
    <h1 style="font-size:22px;margin:6px 0 10px;color:${copy.color}">${copy.heading}</h1>
    <p style="margin:0;line-height:1.6">${copy.line}</p>
    <ul style="margin:14px 0 0;padding-left:18px;color:#667089;line-height:1.7">${items}</ul>
    ${note}
    <a href="${escapeHtml(url)}" style="display:inline-block;margin-top:22px;padding:12px 22px;border-radius:99px;background:#f2c14e;color:#0b1f4d;font-weight:700;text-decoration:none">Open my requests</a>`);
  const text = [
    copy.heading,
    copy.line.replace(/<[^>]+>/g, ''),
    '',
    ...request.items.map((i) => `- ${i.name}: ${formatMoney(i.price, cur)}`),
    request.adminNote ? `\nNote from your admin: ${request.adminNote}` : '',
    '',
    `Open the app: ${url}`,
  ].join('\n');
  return { subject: copy.subject, html, text };
}

function simpleEmail({ teamName, heading, lines, button, url }) {
  const html = shell(`
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b5821f;font-weight:700">${escapeHtml(teamName)}</div>
    <h1 style="font-size:22px;margin:6px 0 10px;color:#0b1f4d">${escapeHtml(heading)}</h1>
    ${lines.map((l) => `<p style="margin:0 0 8px;line-height:1.6">${l}</p>`).join('')}
    <a href="${escapeHtml(url)}" style="display:inline-block;margin-top:16px;padding:12px 22px;border-radius:99px;background:#f2c14e;color:#0b1f4d;font-weight:700;text-decoration:none">${escapeHtml(button)}</a>`);
  const text = [heading, ...lines.map((l) => l.replace(/<[^>]+>/g, '')), '', `${button}: ${url}`].join('\n');
  return { html, text };
}

function scoutingReminderEmail({ member, minimum, teamName, url }) {
  const first = String(member.displayName || '').split(' ')[0] || 'there';
  return {
    subject: "Reminder: log today's scouting",
    ...simpleEmail({
      teamName,
      heading: "Don't forget today's scouting 📋",
      lines: [
        `Hi ${escapeHtml(first)}, you haven't logged your scouting for today yet.`,
        minimum
          ? `Today's minimum is <b>${minimum.dms} scouting DMs</b>, <b>${minimum.posts} posts</b> and <b>${minimum.engagements} engagements</b>.`
          : '',
        'Add your DMs, posts, engagements and any podcasts you watched — it only takes a minute.',
      ].filter(Boolean),
      button: 'Log my scouting',
      url,
    }),
  };
}

function goalsSentEmail({ member, goals, monthLabel, teamName, url }) {
  return {
    subject: `${member.displayName} sent ${goals.length} goal${goals.length === 1 ? '' : 's'} for ${monthLabel}`,
    ...simpleEmail({
      teamName,
      heading: `New goals from ${member.displayName}`,
      lines: [`For <b>${escapeHtml(monthLabel)}</b>:`, `<ul style="margin:0;padding-left:18px">${goals.map((g) => `<li>${escapeHtml(g.text)}</li>`).join('')}</ul>`],
      button: 'See team goals',
      url,
    }),
  };
}

function goalCommentEmail({ member, comment, monthLabel, teamName, url }) {
  const first = String(member.displayName || '').split(' ')[0] || 'there';
  return {
    subject: `Your admin commented on your ${monthLabel} goals`,
    ...simpleEmail({
      teamName,
      heading: 'New comment on your goals',
      lines: [`Hi ${escapeHtml(first)}, here's what your admin said about your goals for ${escapeHtml(monthLabel)}:`, `<i>“${escapeHtml(comment)}”</i>`],
      button: 'Open my goals',
      url,
    }),
  };
}

module.exports = { formatMoney, POT_LABELS, createNotifier, fundRequestEmail, memberRequestEmail, scoutingReminderEmail, goalsSentEmail, goalCommentEmail };

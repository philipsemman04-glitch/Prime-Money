// Phone/browser notifications (Web Push). Needs VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY; without them every send is skipped.
function createPusher({ publicKey, privateKey, subject, webpush } = {}) {
  if (!publicKey || !privateKey) {
    return { enabled: false, publicKey: null, async send() { return { skipped: true }; } };
  }
  webpush = webpush ?? require('web-push');
  webpush.setVapidDetails(subject || 'mailto:admin@example.com', publicKey, privateKey);
  return {
    enabled: true,
    publicKey,
    // Throws with err.statusCode 404/410 when the device has unsubscribed.
    async send(subscription, payload) {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 24 * 3600, timeout: 8000 });
      return { sent: true };
    },
  };
}

module.exports = { createPusher };

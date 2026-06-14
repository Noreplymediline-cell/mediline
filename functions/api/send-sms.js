/**
 * Cloudflare Pages Function — SMS via Twilio
 * Route : /api/send-sms
 *
 * Variables Cloudflare requises :
 *   TWILIO_ACCOUNT_SID  — ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN   — xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_FROM_NUMBER  — +33xxxxxxxxx (numéro Twilio vérifié)
 *
 * Usage : POST { to, message }
 * Retourne : { ok: true, sid } ou { ok: false, error }
 */

export async function onRequestPost({ request, env }) {
  // ── Vérifier les variables ───────────────────────────────
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    console.error('[SMS] Variables Twilio manquantes');
    return json({ ok: false, error: 'SMS non configuré (variables Twilio manquantes)' }, 500);
  }

  let payload;
  try { payload = await request.json(); }
  catch(e) { return json({ ok: false, error: 'JSON invalide' }, 400); }

  const { to, message } = payload;

  if (!to || !message) {
    return json({ ok: false, error: 'to et message requis' }, 400);
  }

  // Normaliser le numéro : ajouter +33 si numéro français sans indicatif
  let phone = String(to).replace(/\s/g, '');
  if (phone.startsWith('0') && phone.length === 10) {
    phone = '+33' + phone.slice(1);
  }
  if (!phone.startsWith('+')) {
    return json({ ok: false, error: 'Numéro de téléphone invalide (format attendu : +33xxxxxxxxx)' }, 400);
  }

  // ── Envoi via Twilio ─────────────────────────────────────
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: env.TWILIO_FROM_NUMBER,
        To: phone,
        Body: message
      }).toString()
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('[SMS] Twilio erreur:', res.status, JSON.stringify(data));
      return json({ ok: false, error: data.message || `Twilio HTTP ${res.status}` }, 200);
    }

    console.log('[SMS] Envoyé →', phone, '| sid:', data.sid);
    return json({ ok: true, sid: data.sid });

  } catch(e) {
    console.error('[SMS] Fetch erreur:', e.message);
    return json({ ok: false, error: 'Erreur réseau vers Twilio' }, 200);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

/**
 * Cloudflare Pages Function — SMS via Twilio
 * Route : /api/send-sms
 *
 * Variables d'environnement requises dans Cloudflare :
 *   TWILIO_ACCOUNT_SID  : ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN   : votre auth token Twilio
 *   TWILIO_PHONE_NUMBER : +1XXXXXXXXXX (numéro Twilio)
 *
 * Body JSON attendu :
 *   { to: "+33612345678", message: "Bonjour..." }
 */

export async function onRequestPost({ request, env }) {
  try {
    const { to, message } = await request.json();

    if (!to || !message) {
      return Response.json({ ok: false, error: 'to et message requis' }, { status: 400 });
    }

    const sid   = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from  = env.TWILIO_PHONE_NUMBER;

    if (!sid || !token || !from) {
      return Response.json({ ok: false, error: 'Twilio non configuré' }, { status: 503 });
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ To: to, From: from, Body: message });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(sid + ':' + token),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[SMS] Twilio erreur:', data);
      return Response.json({ ok: false, error: data.message || 'Erreur Twilio' }, { status: 502 });
    }

    return Response.json({ ok: true, sid: data.sid });

  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

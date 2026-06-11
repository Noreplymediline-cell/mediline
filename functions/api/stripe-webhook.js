/**
 * Cloudflare Pages Function — Stripe Webhook
 * Route : /api/stripe-webhook
 *
 * Variables d'environnement requises (Cloudflare Dashboard > Settings > Variables) :
 *   STRIPE_WEBHOOK_SECRET   — whsec_... (depuis Stripe Dashboard > Webhooks)
 *   FIREBASE_DB_URL         — https://votre-projet-default-rtdb.firebaseio.com
 *   FIREBASE_SERVICE_KEY    — JSON stringifié de votre clé de service Firebase Admin
 *
 * Événements Stripe écoutés :
 *   payment_intent.succeeded         → hasPaid=true, subscriptionStatus='active'
 *   invoice.payment_succeeded        → renouvellement mensuel confirmé
 *   customer.subscription.deleted   → abonnement annulé → subscriptionStatus='cancelled'
 *   invoice.payment_failed           → échec paiement → subscriptionStatus='past_due'
 */

export async function onRequestPost({ request, env }) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  // ── 1. Vérifier la signature Stripe ────────────────────────────────────
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('[WEBHOOK] STRIPE_WEBHOOK_SECRET manquant');
    return new Response('Configuration manquante', { status: 500 });
  }

  let event;
  try {
    event = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Signature invalide:', err.message);
    return new Response('Signature invalide', { status: 400 });
  }

  console.log('[WEBHOOK] Événement reçu:', event.type, '| id:', event.id);

  // ── 2. Traiter l'événement ──────────────────────────────────────────────
  try {
    const dbUrl = env.FIREBASE_DB_URL;
    if (!dbUrl) throw new Error('FIREBASE_DB_URL manquant');

    switch (event.type) {

      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const uid = pi.metadata && pi.metadata.mediline_uid;
        const plan = pi.metadata && pi.metadata.mediline_plan;
        if (!uid) { console.warn('[WEBHOOK] payment_intent sans mediline_uid'); break; }
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          hasPaid: true,
          subscriptionStatus: 'active',
          plan: plan || 'cabinet_40',
          paymentStatus: 'confirmed',
          paidAt: Date.now(),
          stripePaymentIntentId: pi.id
        }, env);
        console.log('[WEBHOOK] hasPaid=true pour uid:', uid);
        break;
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        const customerId = inv.customer;
        if (!customerId) break;
        // Retrouver l'uid via stripeCustomerId stocké dans Firebase
        const uid = await findUidByStripeCustomer(dbUrl, customerId, env);
        if (!uid) { console.warn('[WEBHOOK] Aucun uid pour customer:', customerId); break; }
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          hasPaid: true,
          subscriptionStatus: 'active',
          paymentStatus: 'confirmed',
          lastRenewalAt: Date.now(),
          stripeCustomerId: customerId
        }, env);
        console.log('[WEBHOOK] Renouvellement confirmé pour uid:', uid);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const uid = await findUidByStripeCustomer(dbUrl, customerId, env);
        if (!uid) break;
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          hasPaid: false,
          subscriptionStatus: 'cancelled',
          paymentStatus: 'cancelled',
          cancelledAt: Date.now()
        }, env);
        console.log('[WEBHOOK] Abonnement annulé pour uid:', uid);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const customerId = inv.customer;
        const uid = await findUidByStripeCustomer(dbUrl, customerId, env);
        if (!uid) break;
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          subscriptionStatus: 'past_due',
          paymentStatus: 'failed',
          lastPaymentFailedAt: Date.now()
        }, env);
        console.log('[WEBHOOK] Échec paiement pour uid:', uid);
        break;
      }

      default:
        console.log('[WEBHOOK] Événement ignoré:', event.type);
    }
  } catch (err) {
    console.error('[WEBHOOK] Erreur traitement:', err.message);
    return new Response('Erreur serveur', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function firebaseUpdate(dbUrl, path, data, env) {
  const url = `${dbUrl}/${path}.json`;
  const headers = { 'Content-Type': 'application/json' };
  // Authentification Firebase Admin via service account si disponible
  if (env.FIREBASE_SERVICE_KEY) {
    try {
      const token = await getFirebaseAdminToken(env.FIREBASE_SERVICE_KEY);
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch(e) {
      console.warn('[WEBHOOK] Firebase auth token error:', e.message);
    }
  }
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`Firebase PATCH ${path} failed: ${res.status}`);
  return res.json();
}

async function findUidByStripeCustomer(dbUrl, customerId, env) {
  // Chercher dans users/ l'entrée ayant stripeCustomerId = customerId
  const url = `${dbUrl}/users.json?orderBy="stripeCustomerId"&equalTo="${customerId}"&limitToFirst=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data) return null;
    const keys = Object.keys(data);
    return keys.length > 0 ? keys[0] : null;
  } catch(e) {
    console.error('[WEBHOOK] findUidByStripeCustomer error:', e.message);
    return null;
  }
}

async function getFirebaseAdminToken(serviceKeyJson) {
  // Génère un access token Firebase Admin via JWT RS256
  const svc = JSON.parse(serviceKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: svc.client_email,
    sub: svc.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  };
  const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const keyData = svc.private_key.replace(/-----[A-Z ]+-----/g,'').replace(/\s/g,'');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token || null;
}

async function verifyStripeSignature(body, sigHeader, secret) {
  // Vérification HMAC-SHA256 de la signature Stripe
  if (!sigHeader) throw new Error('En-tête stripe-signature manquant');
  const parts = {};
  sigHeader.split(',').forEach(p => { const [k,v] = p.split('='); parts[k] = v; });
  const ts = parts['t'];
  const v1 = parts['v1'];
  if (!ts || !v1) throw new Error('Signature malformée');
  const tolerance = 300; // 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(ts)) > tolerance)
    throw new Error('Timestamp expiré');
  const signed = `${ts}.${body}`;
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(signed);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (computed !== v1) throw new Error('Signature HMAC invalide');
  return JSON.parse(body);
}

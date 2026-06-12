/**
 * Cloudflare Pages Function — Stripe Webhook
 * Route : /api/stripe-webhook
 *
 * Variables d'environnement requises :
 *   STRIPE_WEBHOOK_SECRET   — whsec_...
 *   FIREBASE_DB_URL         — https://votre-projet-default-rtdb.firebaseio.com
 *   FIREBASE_SERVICE_KEY    — JSON stringifié clé service Firebase Admin
 *
 * Événements gérés :
 *   checkout.session.completed       → paiement Checkout confirmé
 *   customer.subscription.updated   → changement statut abonnement
 *   customer.subscription.deleted   → annulation abonnement
 *   invoice.payment_succeeded        → renouvellement mensuel
 *   invoice.payment_failed           → échec paiement
 *   payment_intent.succeeded         → paiement direct confirmé
 */

export async function onRequestPost({ request, env }) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

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

  try {
    const dbUrl = env.FIREBASE_DB_URL;
    if (!dbUrl) throw new Error('FIREBASE_DB_URL manquant');

    switch (event.type) {

      // ── Paiement Checkout (flux principal MediLine) ─────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        // uid peut être dans metadata.mediline_uid ou client_reference_id
        const uid = (session.metadata && session.metadata.mediline_uid)
          || session.client_reference_id;
        const plan = session.metadata && session.metadata.mediline_plan;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (!uid) {
          console.warn('[WEBHOOK] checkout.session sans mediline_uid/client_reference_id');
          // Tentative de lookup par email
          if (session.customer_email) {
            const uidByEmail = await findUidByEmail(dbUrl, session.customer_email, env);
            if (uidByEmail) {
              await activateSubscription(dbUrl, uidByEmail, { plan, customerId, subscriptionId, sessionId: session.id }, env);
            } else {
              console.error('[WEBHOOK] checkout.session: aucun uid trouvé pour', session.customer_email);
            }
          }
          break;
        }

        await activateSubscription(dbUrl, uid, { plan, customerId, subscriptionId, sessionId: session.id }, env);
        console.log('[WEBHOOK] checkout.session.completed — uid:', uid, '| plan:', plan);
        break;
      }

      // ── Mise à jour abonnement (upgrade, downgrade, reactivation) ───
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const uid = await findUidByStripeCustomer(dbUrl, customerId, env);
        if (!uid) { console.warn('[WEBHOOK] subscription.updated: uid introuvable pour', customerId); break; }

        const status = sub.status; // active, past_due, canceled, trialing…
        const isActive = status === 'active' || status === 'trialing';
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          hasPaid: isActive,
          subscriptionStatus: isActive ? 'active' : status,
          stripeSubscriptionStatus: status,
          stripeSubscriptionId: sub.id,
          stripeCustomerId: customerId,
          subscriptionUpdatedAt: Date.now()
        }, env);
        // Mettre à jour le cabinet aussi
        await firebaseUpdate(dbUrl, `cabinets/${uid}`, {
          subscriptionStatus: isActive ? 'active' : status,
          subscriptionUpdatedAt: Date.now()
        }, env);
        console.log('[WEBHOOK] subscription.updated — uid:', uid, '| status:', status);
        break;
      }

      // ── Annulation abonnement ────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const uid = await findUidByStripeCustomer(dbUrl, customerId, env);
        if (!uid) break;
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          hasPaid: false,
          subscriptionStatus: 'cancelled',
          stripeSubscriptionStatus: 'canceled',
          cancelledAt: Date.now()
        }, env);
        await firebaseUpdate(dbUrl, `cabinets/${uid}`, {
          subscriptionStatus: 'cancelled',
          cancelledAt: Date.now()
        }, env);
        console.log('[WEBHOOK] subscription.deleted — uid:', uid);
        break;
      }

      // ── Renouvellement mensuel confirmé ──────────────────────────────
      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        const customerId = inv.customer;
        if (!customerId) break;
        const uid = await findUidByStripeCustomer(dbUrl, customerId, env);
        if (!uid) { console.warn('[WEBHOOK] invoice.succeeded: uid introuvable pour', customerId); break; }
        await firebaseUpdate(dbUrl, `users/${uid}`, {
          hasPaid: true,
          subscriptionStatus: 'active',
          paymentStatus: 'confirmed',
          lastRenewalAt: Date.now(),
          stripeCustomerId: customerId
        }, env);
        await firebaseUpdate(dbUrl, `cabinets/${uid}`, {
          subscriptionStatus: 'active',
          lastRenewalAt: Date.now()
        }, env);
        console.log('[WEBHOOK] invoice.payment_succeeded — uid:', uid);
        break;
      }

      // ── Échec paiement ───────────────────────────────────────────────
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
        await firebaseUpdate(dbUrl, `cabinets/${uid}`, {
          subscriptionStatus: 'past_due'
        }, env);
        console.log('[WEBHOOK] invoice.payment_failed — uid:', uid);
        break;
      }

      // ── Paiement direct (PaymentIntent) ─────────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const uid = pi.metadata && pi.metadata.mediline_uid;
        const plan = pi.metadata && pi.metadata.mediline_plan;
        if (!uid) { console.warn('[WEBHOOK] payment_intent sans mediline_uid'); break; }
        await activateSubscription(dbUrl, uid, {
          plan,
          customerId: pi.customer,
          paymentIntentId: pi.id
        }, env);
        console.log('[WEBHOOK] payment_intent.succeeded — uid:', uid);
        break;
      }

      default:
        console.log('[WEBHOOK] Événement ignoré:', event.type);
    }
  } catch (err) {
    console.error('[WEBHOOK] Erreur traitement:', err.message, err.stack);
    return new Response('Erreur serveur', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

// ── Activation abonnement (helper commun) ────────────────────────────────
async function activateSubscription(dbUrl, uid, { plan, customerId, subscriptionId, sessionId, paymentIntentId } = {}, env) {
  const resolvedPlan = plan || 'cabinet_40';
  const maxDoctors = resolvedPlan === 'cabinet_90' ? 999 : 3;
  const update = {
    hasPaid: true,
    subscriptionStatus: 'active',
    plan: resolvedPlan,
    maxDoctors,
    paymentStatus: 'confirmed',
    paidAt: Date.now()
  };
  if (customerId) update.stripeCustomerId = customerId;
  if (subscriptionId) update.stripeSubscriptionId = subscriptionId;
  if (sessionId) update.stripeSessionId = sessionId;
  if (paymentIntentId) update.stripePaymentIntentId = paymentIntentId;

  await firebaseUpdate(dbUrl, `users/${uid}`, update, env);
  // Mettre à jour le cabinet aussi pour que les listeners temps réel se déclenchent
  await firebaseUpdate(dbUrl, `cabinets/${uid}`, {
    subscriptionStatus: 'active',
    plan: resolvedPlan,
    paidAt: Date.now()
  }, env);
}

// ── Firebase PATCH ───────────────────────────────────────────────────────
async function firebaseUpdate(dbUrl, path, data, env) {
  const url = `${dbUrl.replace(/\/$/, '')}/${path}.json`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.FIREBASE_SERVICE_KEY) {
    try {
      const token = await getFirebaseAdminToken(env.FIREBASE_SERVICE_KEY);
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch(e) {
      console.warn('[WEBHOOK] Firebase auth token error:', e.message);
    }
  }
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(data) });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Firebase PATCH ${path} failed: ${res.status} ${errBody.slice(0,200)}`);
  }
  return res.json();
}

// ── Lookup uid par stripeCustomerId ──────────────────────────────────────
async function findUidByStripeCustomer(dbUrl, customerId, env) {
  const url = `${dbUrl.replace(/\/$/, '')}/users.json?orderBy="stripeCustomerId"&equalTo="${customerId}"&limitToFirst=1`;
  const headers = {};
  if (env.FIREBASE_SERVICE_KEY) {
    try { const t = await getFirebaseAdminToken(env.FIREBASE_SERVICE_KEY); if (t) headers['Authorization'] = `Bearer ${t}`; } catch(e) {}
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    const keys = Object.keys(data);
    return keys.length > 0 ? keys[0] : null;
  } catch(e) {
    console.error('[WEBHOOK] findUidByStripeCustomer:', e.message);
    return null;
  }
}

// ── Lookup uid par email ─────────────────────────────────────────────────
async function findUidByEmail(dbUrl, email, env) {
  const url = `${dbUrl.replace(/\/$/, '')}/users.json?orderBy="mail"&equalTo="${email}"&limitToFirst=1`;
  const headers = {};
  if (env.FIREBASE_SERVICE_KEY) {
    try { const t = await getFirebaseAdminToken(env.FIREBASE_SERVICE_KEY); if (t) headers['Authorization'] = `Bearer ${t}`; } catch(e) {}
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    const keys = Object.keys(data);
    return keys.length > 0 ? keys[0] : null;
  } catch(e) {
    return null;
  }
}

// ── Firebase Admin JWT ───────────────────────────────────────────────────
async function getFirebaseAdminToken(serviceKeyJson) {
  const svc = JSON.parse(serviceKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: svc.client_email, sub: svc.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  };
  const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const keyData = svc.private_key.replace(/-----[A-Z ]+-----/g,'').replace(/\s/g,'');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('No access_token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// ── Vérification signature Stripe HMAC-SHA256 ────────────────────────────
async function verifyStripeSignature(body, sigHeader, secret) {
  if (!sigHeader) throw new Error('En-tête stripe-signature manquant');
  const parts = {};
  sigHeader.split(',').forEach(p => { const [k,...v] = p.split('='); parts[k] = v.join('='); });
  const ts = parts['t'];
  const v1 = parts['v1'];
  if (!ts || !v1) throw new Error('Signature malformée');
  if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) throw new Error('Timestamp expiré (>5min)');
  const signed = `${ts}.${body}`;
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(signed);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('');
  if (computed !== v1) throw new Error('Signature HMAC invalide');
  return JSON.parse(body);
}

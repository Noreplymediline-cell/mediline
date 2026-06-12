/**
 * Cloudflare Pages Function — Stripe Billing Portal
 * Route : /api/stripe-portal
 *
 * Variables d'environnement requises :
 *   STRIPE_SECRET_KEY   — sk_live_... (Stripe Dashboard > Developers > API keys)
 *
 * Usage : POST { customerId, returnUrl }
 * Retourne : { url } — URL du portail Stripe à ouvrir
 *
 * Le portail Stripe permet au médecin de :
 *   - Voir ses factures
 *   - Changer de carte bancaire
 *   - Mettre à jour son abonnement
 *   - Annuler son abonnement
 */

export async function onRequestPost({ request, env }) {
  // ── Vérifier la clé secrète Stripe ──────────────────────────────
  if (!env.STRIPE_SECRET_KEY) {
    console.error('[PORTAL] STRIPE_SECRET_KEY manquant');
    return json({ error: 'Configuration manquante' }, 500);
  }
  if (!env.STRIPE_SECRET_KEY.startsWith('sk_')) {
    console.error('[PORTAL] STRIPE_SECRET_KEY invalide (doit commencer par sk_)');
    return json({ error: 'Clé Stripe invalide' }, 500);
  }

  // ── Parser le body ───────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch(e) {
    return json({ error: 'Payload invalide' }, 400);
  }

  const { customerId, returnUrl } = body;

  if (!customerId || !customerId.startsWith('cus_')) {
    return json({ error: 'customerId Stripe manquant ou invalide' }, 400);
  }

  const safeReturnUrl = returnUrl || 'https://medilinee.louis16907.workers.dev';

  // ── Créer la session Billing Portal ─────────────────────────────
  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        customer: customerId,
        return_url: safeReturnUrl
      }).toString()
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[PORTAL] Stripe error:', res.status, JSON.stringify(data));
      return json({ error: data.error?.message || 'Erreur Stripe' }, res.status);
    }

    console.log('[PORTAL] Session créée pour customer:', customerId);
    return json({ url: data.url });

  } catch(e) {
    console.error('[PORTAL] Fetch error:', e.message);
    return json({ error: 'Erreur réseau' }, 503);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ── OPTIONS preflight (CORS) ─────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

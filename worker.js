/**
 * Cloudflare Worker — MediLine API
 * Gère les routes /api/* et sert les assets statiques
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── Route /api/send-email ────────────────────────────────────
    if (url.pathname === '/api/send-email') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }
      if (request.method !== 'POST') {
        return jsonResp({ ok: false, error: 'Méthode non autorisée' }, 405);
      }
      return handleSendEmail(request, env);
    }

    // ── Route /api/stripe-webhook ────────────────────────────────
    if (url.pathname === '/api/stripe-webhook') {
      if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);
      return handleStripeWebhook(request, env);
    }

    // ── Route /api/stripe-portal ─────────────────────────────────
    if (url.pathname === '/api/stripe-portal') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
      }
      if (request.method !== 'POST') return jsonResp({ error: 'POST only' }, 405);
      return handleStripePortal(request, env);
    }

    // ── Assets statiques (index.html etc.) ───────────────────────
    return env.ASSETS.fetch(request);
  }
};

// ════════════════════════════════════════════════════════════════
// SEND EMAIL via Resend
// ════════════════════════════════════════════════════════════════
async function handleSendEmail(request, env) {
  const FROM = 'MediLine <onboarding@resend.dev>';

  if (!env.RESEND_API_KEY) {
    console.error('[EMAIL] RESEND_API_KEY manquante');
    return jsonResp({ ok: false, error: 'RESEND_API_KEY missing' }, 500);
  }

  let payload;
  try { payload = await request.json(); }
  catch(e) { return jsonResp({ ok: false, error: 'JSON invalide' }, 400); }

  const { type, to } = payload;
  if (!to || !to.includes('@')) return jsonResp({ ok: false, error: 'Email invalide' }, 400);

  let subject = '', html = '';

  if (type === 'otp' || type === 'verification') {
    const code = payload.code;
    if (!code) return jsonResp({ ok: false, error: 'Code OTP manquant' }, 400);
    subject = `🔒 Votre code MediLine : ${code}`;
    html = `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Vérification de votre email</h2>
      <p style="color:#374151">Votre code de vérification MediLine :</p>
      <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
        <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#1d4ed8;font-family:monospace">${esc(String(code))}</span>
      </div>
      <p style="color:#6b7280;font-size:13px">Valable <strong>10 minutes</strong>. Si vous n'avez pas demandé ce code, ignorez cet email.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="color:#9ca3af;font-size:11px">MediLine — La salle d'attente intelligente</p>
    </div>`;

  } else if (type === 'reset') {
    const link = payload.link;
    if (!link) return jsonResp({ ok: false, error: 'Lien reset manquant' }, 400);
    subject = '🔑 Réinitialisation mot de passe MediLine';
    html = `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
      <h2 style="color:#1e3a5f">Réinitialisation mot de passe</h2>
      <p style="margin:28px 0">
        <a href="${esc(link)}" style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
          Réinitialiser mon mot de passe →
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px">Ce lien est valable 48 heures.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="color:#9ca3af;font-size:11px">MediLine</p>
    </div>`;

  } else if (type === 'doctor_invite') {
    const { doctor_name, invite_link } = payload;
    subject = 'Invitation à rejoindre MediLine';
    html = `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
      <h2 style="color:#2563eb">Vous avez été invité sur MediLine</h2>
      <p>Bonjour Dr. ${esc(doctor_name || '')},</p>
      <p>Vous avez été invité à rejoindre un cabinet médical sur MediLine.</p>
      <p style="margin:28px 0">
        <a href="${esc(invite_link || '')}" style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
          Créer mon compte →
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px">Lien valable 48 heures.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="color:#9ca3af;font-size:11px">MediLine</p>
    </div>`;

  } else {
    return jsonResp({ ok: false, error: `Type inconnu: ${type}` }, 400);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[EMAIL] Resend erreur:', res.status, JSON.stringify(data));
      return jsonResp({ ok: false, error: data.message || `Resend HTTP ${res.status}`, detail: data }, res.status < 500 ? res.status : 502);
    }
    console.log('[EMAIL] Envoyé:', type, '→', to, '| id:', data.id);
    return jsonResp({ ok: true, id: data.id });
  } catch(e) {
    console.error('[EMAIL] Fetch erreur:', e.message);
    return jsonResp({ ok: false, error: e.message }, 503);
  }
}

// ════════════════════════════════════════════════════════════════
// STRIPE PORTAL
// ════════════════════════════════════════════════════════════════
async function handleStripePortal(request, env) {
  if (!env.STRIPE_SECRET_KEY) return jsonResp({ error: 'STRIPE_SECRET_KEY manquante' }, 500);
  let body;
  try { body = await request.json(); } catch(e) { return jsonResp({ error: 'JSON invalide' }, 400); }
  const { customerId, returnUrl } = body;
  if (!customerId) return jsonResp({ error: 'customerId manquant' }, 400);
  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ customer: customerId, return_url: returnUrl || 'https://medilinee.louis16907.workers.dev' }).toString()
  });
  const data = await res.json();
  if (!res.ok) return jsonResp({ error: data.error?.message || 'Erreur Stripe' }, res.status);
  return jsonResp({ url: data.url });
}

// ════════════════════════════════════════════════════════════════
// STRIPE WEBHOOK (simplifié)
// ════════════════════════════════════════════════════════════════
async function handleStripeWebhook(request, env) {
  // Déléguer au worker existant si possible, sinon répondre OK
  return new Response('OK', { status: 200 });
}

// ── Helpers ──────────────────────────────────────────────────────
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

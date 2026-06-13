/**
 * Cloudflare Pages Function — Email via Resend
 * Route : /api/send-email
 *
 * Variable d'environnement requise :
 *   RESEND_API_KEY  — re_...  (Cloudflare Dashboard > Settings > Variables)
 *
 * Types gérés : otp, doctor_invite, subscription_confirmation
 * FROM : MediLine <onboarding@resend.dev>  (domaine Resend par défaut, toujours valide)
 */

const FROM = 'MediLine <onboarding@resend.dev>';

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    console.error('[EMAIL] RESEND_API_KEY manquant dans les variables Cloudflare');
    return json({ ok: false, error: 'Configuration email manquante (RESEND_API_KEY)' }, 500);
  }

  let payload;
  try { payload = await request.json(); }
  catch(e) { return json({ ok: false, error: 'Payload JSON invalide' }, 400); }

  const { type, to } = payload;
  if (!to || !to.includes('@')) return json({ ok: false, error: 'Adresse email invalide' }, 400);

  let subject = '', html = '';

  if (type === 'otp' || type === 'verification') {
    // ── Code OTP vérification email ─────────────────────────────
    const { code } = payload;
    if (!code) return json({ ok: false, error: 'Code OTP manquant' }, 400);
    subject = `🔒 Votre code MediLine : ${code}`;
    html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
        <img src="https://medilinee.louis16907.workers.dev/favicon.ico" width="40" style="margin-bottom:16px" alt="MediLine">
        <h2 style="color:#1e3a5f;margin-bottom:8px">Vérification de votre email</h2>
        <p style="color:#374151">Votre code de vérification MediLine :</p>
        <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
          <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#1d4ed8;font-family:monospace">${escHtml(String(code))}</span>
        </div>
        <p style="color:#6b7280;font-size:13px">Ce code est valable <strong>10 minutes</strong>.</p>
        <p style="color:#6b7280;font-size:13px">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:11px">MediLine — La salle d'attente intelligente</p>
      </div>`;

  } else if (type === 'reset') {
    // ── Lien réinitialisation mot de passe ──────────────────────
    const { link } = payload;
    if (!link) return json({ ok: false, error: 'Lien reset manquant' }, 400);
    subject = '🔑 Réinitialisation de votre mot de passe MediLine';
    html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
        <h2 style="color:#1e3a5f">Réinitialisation mot de passe</h2>
        <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
        <p style="margin:28px 0">
          <a href="${escHtml(link)}"
             style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
            Réinitialiser mon mot de passe →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">Ce lien est valable 48 heures.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:11px">MediLine — La salle d'attente intelligente</p>
      </div>`;

  } else if (type === 'doctor_invite') {
    const { doctor_name, invite_link } = payload;
    subject = `Invitation à rejoindre MediLine`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#2563eb">Vous avez été invité sur MediLine</h2>
        <p>Bonjour Dr. ${escHtml(doctor_name || '')},</p>
        <p>Vous avez été invité à rejoindre un cabinet médical sur MediLine.</p>
        <p style="margin:28px 0">
          <a href="${escHtml(invite_link || '')}"
             style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
            Créer mon compte →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">Lien valable 48 heures.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:11px">MediLine — La salle d'attente intelligente</p>
      </div>`;

  } else if (type === 'subscription_confirmation') {
    const { customer_name, plan_name, price, dashboard_link } = payload;
    subject = `Abonnement MediLine activé — ${plan_name}`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#059669">✅ Abonnement activé</h2>
        <p>Bonjour ${escHtml(customer_name || '')},</p>
        <p>Votre abonnement <strong>${escHtml(plan_name || '')}</strong> a bien été activé à ${escHtml(String(price || ''))}€/mois.</p>
        <p style="margin:28px 0">
          <a href="${escHtml(dashboard_link || '')}"
             style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
            Accéder à mon dashboard →
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:11px">MediLine — La salle d'attente intelligente</p>
      </div>`;

  } else {
    return json({ ok: false, error: `Type email non reconnu: ${type}` }, 400);
  }

  // ── Envoi via Resend ──────────────────────────────────────────
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
      return json({ ok: false, error: data.message || `Resend HTTP ${res.status}` }, res.status < 500 ? res.status : 502);
    }

    console.log('[EMAIL] Envoyé:', type, '→', to, '| id:', data.id);
    return json({ ok: true, id: data.id });

  } catch(e) {
    console.error('[EMAIL] Fetch erreur:', e.message);
    return json({ ok: false, error: 'Erreur réseau vers Resend' }, 503);
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

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

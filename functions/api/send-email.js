/**
 * Cloudflare Pages Function — Email via Resend
 * Route : /api/send-email
 *
 * Variable d'environnement requise (Cloudflare Dashboard > Settings > Variables) :
 *   RESEND_API_KEY  — re_...  (depuis resend.com > API Keys)
 *
 * Types d'emails gérés : doctor_invite, subscription_confirmation
 */

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    console.error('[EMAIL] RESEND_API_KEY manquant');
    return json({ ok: false, error: 'Configuration email manquante' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch(e) {
    return json({ ok: false, error: 'Payload invalide' }, 400);
  }

  const { type, to } = payload;
  if (!to || !to.includes('@')) return json({ ok: false, error: 'Email destinataire invalide' }, 400);

  let subject, html;

  if (type === 'doctor_invite') {
    const { doctor_name, invite_link } = payload;
    subject = `Invitation à rejoindre MediLine`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#2563eb">Vous avez été invité sur MediLine</h2>
        <p>Bonjour Dr. ${escHtml(doctor_name || '')},</p>
        <p>Vous avez été invité à rejoindre un cabinet médical sur MediLine, la plateforme de gestion de file d'attente intelligente.</p>
        <p style="margin:28px 0">
          <a href="${escHtml(invite_link || '')}"
             style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
            Créer mon compte →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">Ce lien est valide 48 heures. Si vous n'attendiez pas cet email, vous pouvez l'ignorer.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:12px">MediLine — La salle d'attente intelligente</p>
      </div>`;

  } else if (type === 'subscription_confirmation') {
    const { customer_name, plan_name, price, dashboard_link } = payload;
    subject = `Abonnement MediLine activé — ${plan_name}`;
    html = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">
        <h2 style="color:#059669">✅ Abonnement activé</h2>
        <p>Bonjour ${escHtml(customer_name || '')},</p>
        <p>Votre abonnement <strong>${escHtml(plan_name || '')}</strong> a bien été activé à ${escHtml(price || '')}€/mois.</p>
        <p style="margin:28px 0">
          <a href="${escHtml(dashboard_link || '')}"
             style="background:#2563eb;color:#fff;padding:13px 28px;border-radius:9px;text-decoration:none;font-weight:700;font-size:15px">
            Accéder à mon dashboard →
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="color:#9ca3af;font-size:12px">MediLine — La salle d'attente intelligente</p>
      </div>`;

  } else {
    return json({ ok: false, error: `Type email inconnu: ${type}` }, 400);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MediLine <noreply@mediline.fr>',
        to: [to],
        subject,
        html
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[EMAIL] Resend error:', res.status, JSON.stringify(data));
      return json({ ok: false, error: data.message || 'Resend error' }, 502);
    }

    console.log('[EMAIL] Envoyé:', type, 'à', to, '| id:', data.id);
    return json({ ok: true, id: data.id });

  } catch(e) {
    console.error('[EMAIL] Fetch error:', e.message);
    return json({ ok: false, error: 'Erreur réseau' }, 503);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

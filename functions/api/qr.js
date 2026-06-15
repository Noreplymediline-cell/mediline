/**
 * Cloudflare Pages Function — Générateur QR Code
 * Route : /api/qr?data=URL_ENCODEE
 * Retourne une image PNG du QR code
 * Utilise l'API QR Server (proxy pour éviter les CORS)
 */

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const data = url.searchParams.get('data') || '';
  
  if (!data) {
    return new Response('data parameter required', { status: 400 });
  }

  // Appel à l'API QR Server côté serveur (pas de pb CORS)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}&color=1d4ed8&bgcolor=ffffff&margin=10&ecc=M`;
  
  try {
    const res = await fetch(qrUrl);
    if (!res.ok) throw new Error('QR API failed');
    
    const img = await res.arrayBuffer();
    
    return new Response(img, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch(e) {
    return new Response('QR generation failed', { status: 502 });
  }
}

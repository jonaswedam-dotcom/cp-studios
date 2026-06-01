// Vercel serverless function — called by AdminPage when approving a user.
// Sends an approval email via Resend (https://resend.com).
//
// Required env vars (set in Vercel dashboard → Project → Settings → Environment Variables):
//   RESEND_API_KEY     — your Resend API key (re_...)
//   RESEND_FROM_EMAIL  — verified sender address, e.g. "CP Studios <hi@yourdomain.com>"
//                        Leave unset to use Resend's test address (delivers only to your
//                        own Resend-verified email — fine for local testing, not production).

const APP_URL = 'https://cpstudios.vercel.app'

function buildHtml(username) {
  const name = username || 'there'
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:48px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#161616;border:1px solid #252525;border-radius:20px;padding:40px 36px;box-sizing:border-box" cellpadding="0" cellspacing="0">
        <tr><td>
          <!-- Wordmark -->
          <p style="margin:0 0 32px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#555">CP Studios</p>

          <!-- Heading -->
          <h1 style="margin:0 0 14px;font-size:26px;font-weight:400;color:#f0f0f0;line-height:1.3">
            You're in, ${name}!
          </h1>

          <!-- Body -->
          <p style="margin:0 0 10px;font-size:15px;line-height:1.65;color:#888">
            Your account has been approved. You can now sign in and access everything CP Studios has to offer.
          </p>
          <p style="margin:0 0 32px;font-size:15px;line-height:1.65;color:#888">
            Welcome to the family.
          </p>

          <!-- CTA -->
          <a href="${APP_URL}"
            style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-size:14px;font-weight:500;letter-spacing:0.01em">
            Sign in to CP Studios →
          </a>

          <!-- Footer -->
          <p style="margin:40px 0 0;font-size:11px;color:#404040;line-height:1.6">
            You're receiving this because your CP Studios account was reviewed and approved by an admin.<br>
            If you didn't request an account, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, username } = req.body ?? {}
  if (!email) {
    return res.status(400).json({ error: 'Missing email' })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // No key configured — log and silently succeed so the approval itself isn't blocked.
    console.warn('[notify-approval] RESEND_API_KEY not set — skipping email')
    return res.status(200).json({ ok: true, skipped: true })
  }

  const from = process.env.RESEND_FROM_EMAIL || 'CP Studios <onboarding@resend.dev>'

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "You've been approved — welcome to CP Studios!",
        html: buildHtml(username),
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.json().catch(() => ({}))
      console.error('[notify-approval] Resend error:', detail)
      // Return 200 so the admin UI doesn't show an error — the approval already succeeded.
      return res.status(200).json({ ok: false, detail })
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[notify-approval] fetch error:', err)
    return res.status(200).json({ ok: false, error: err.message })
  }
}

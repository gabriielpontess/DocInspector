# Supabase Auth — recovery email hardened against link scanners

Use this template only after the Deploy Preview contains the scanner-safe recovery landing flow.

## Recovery template

Configure in Supabase Dashboard → Authentication → Email Templates → Reset Password.

```html
<h2>Redefinir senha do DocInspector</h2>
<p>Recebemos uma solicitação para redefinir sua senha.</p>
<p>
  <a href="{{ .RedirectTo }}#recovery_token={{ .TokenHash }}">
    Continuar redefinição de senha
  </a>
</p>
<p>O código será validado somente depois que você confirmar a ação dentro do DocInspector.</p>
<p>Se você não solicitou a redefinição, ignore este e-mail.</p>
```

## Why this flow

The default `{{ .ConfirmationURL }}` points directly to `/auth/v1/verify`, which is single-use. Email security scanners may request that URL before the user clicks it, consuming the recovery token.

The hardened template sends the token hash to the DocInspector in the URL fragment. URL fragments are not sent to Netlify as part of the HTTP request. The app displays an intermediate confirmation screen and calls `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })` only after the user presses **Continuar redefinição**.

## Redirect configuration

During PR #14 homologation, `redirectTo` remains the exact Deploy Preview origin/path already authorized in Supabase Auth URL Configuration.

For production, replace preview-specific configuration with the production Site URL and keep the preview wildcard only where needed for development/homologation.

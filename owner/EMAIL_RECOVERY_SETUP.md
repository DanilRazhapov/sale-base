# Email delivery and password recovery

SaleBase owner authentication uses Supabase Auth. Cashier PIN/device pairing is unaffected.

## Production setup (Supabase dashboard)

1. Create and verify a sender domain in Resend (https://resend.com/domains). Create a sending API key. Never put the key in Git, Vite variables, Workers' public configuration or browser code.
2. Supabase Dashboard → Authentication → SMTP Settings → Enable custom SMTP. Use Resend's current SMTP credentials (typically host `smtp.resend.com`, port `465` or `587`, username `resend`, password = Resend API key). Set a verified sender address on that domain.
3. Authentication → Email Templates → **Reset Password**: use a template containing a six-digit code rendered by **`{{ .Token }}`**, rather than a confirmation link. Example:
   `Ваш код для восстановления SaleBase: {{ .Token }}`
   The frontend calls `resetPasswordForEmail(email)` and `verifyOtp({ email, token, type: "recovery" })`.
4. Authentication → Rate Limits: review the hourly email rate cap for custom SMTP; the SMTP provider's daily/monthly quota is separate. Keep sensible anti-abuse limits.
5. Send a real test reset email on the production owner site, check both successful and expired/incorrect code handling, then sign in with the new password.
6. If email verification on signup is desired, first confirm SMTP works, then enable **Confirm email** under Auth email settings. The existing registration currently redirects to login with a check-email message; implementing an in-app signup code form is a separate UI step. In Supabase's **Confirm signup** template, `{{ .Token }}` can be used to display the confirmation code.

## Security notes

- Never disclose whether an address has an owner account in public responses.
- Code verification and expiry are handled by Supabase Auth. The resend button has a local 60-second cooldown; authoritative abuse prevention must be configured in Supabase Auth, not in browser state.
- Entering the valid recovery code creates a temporary authenticated session, required for `updateUser({ password })`. The UI signs out after the password is set and returns to the login screen.
- No SQL migration or custom token table is required.
- If the owner **forgot their email** as well as the password, email OTP cannot identify their account. Verify the account email through an existing trusted owner/admin channel; do not expose account enumeration through the public login form.

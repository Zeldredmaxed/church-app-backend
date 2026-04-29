// Backend-hosted password reset page. Served at GET /api/auth/reset.
// The Supabase recovery email's redirectTo points here; we read the
// access_token from the URL hash, show a form, and POST the new password
// to the existing /api/auth/reset-password endpoint.
//
// Self-contained: no external CSS/JS, no framework. Works in any modern
// mobile or desktop browser.

export const RESET_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Reset Password — Shepard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(180deg, #f7f5f0 0%, #ece8df 100%);
      color: #1f2933;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      border-radius: 16px;
      padding: 32px 28px;
      box-shadow: 0 10px 30px rgba(31, 41, 51, 0.08), 0 1px 2px rgba(31, 41, 51, 0.06);
    }
    h1 { font-size: 22px; margin: 0 0 8px; font-weight: 600; letter-spacing: -0.01em; }
    p.lead { margin: 0 0 24px; color: #5a6573; font-size: 15px; line-height: 1.5; }
    label { display: block; font-size: 13px; font-weight: 500; color: #3d4754; margin: 16px 0 6px; }
    input[type="password"] {
      width: 100%;
      padding: 12px 14px;
      font-size: 16px;
      border: 1px solid #d6d3cb;
      border-radius: 10px;
      background: #fafaf7;
      transition: border-color 120ms ease, background 120ms ease;
      font-family: inherit;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #2c5f5d;
      background: #ffffff;
    }
    button {
      margin-top: 24px;
      width: 100%;
      padding: 14px 20px;
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
      background: #2c5f5d;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      font-family: inherit;
      transition: background 120ms ease, transform 60ms ease;
    }
    button:hover:not(:disabled) { background: #234a48; }
    button:active:not(:disabled) { transform: scale(0.99); }
    button:disabled { background: #9aa5ad; cursor: not-allowed; }
    .message {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.45;
      display: none;
    }
    .message.error { display: block; background: #fdecec; color: #8a1f1f; border: 1px solid #f4c8c8; }
    .message.success { display: block; background: #e8f5ee; color: #1f5c3a; border: 1px solid #b8dec8; }
    .message.info { display: block; background: #eef3f7; color: #2a4356; border: 1px solid #c5d6e2; }
    .invalid {
      text-align: center;
      padding: 8px 0;
    }
    .invalid h1 { color: #8a1f1f; }
    .footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #ece8df;
      font-size: 12px;
      color: #8a93a0;
      text-align: center;
    }
    .footer a { color: #2c5f5d; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <h1>Reset your password</h1>
    <p class="lead" id="lead">Enter a new password for your Shepard account.</p>

    <form id="resetForm" novalidate>
      <label for="newPassword">New password</label>
      <input id="newPassword" type="password" autocomplete="new-password" minlength="8" required>

      <label for="confirmPassword">Confirm new password</label>
      <input id="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>

      <button type="submit" id="submitBtn">Update password</button>

      <div class="message" id="message" role="status" aria-live="polite"></div>
    </form>

    <div class="footer">
      Trouble? Email <a href="mailto:support@shepard.love">support@shepard.love</a>
    </div>
  </div>

  <script>
    (function () {
      // Supabase puts recovery tokens in the URL hash (not the query string).
      // Format: #access_token=...&refresh_token=...&expires_in=3600&token_type=bearer&type=recovery
      var hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      var params = new URLSearchParams(hash);
      var accessToken = params.get('access_token');
      var type = params.get('type');
      var error = params.get('error') || params.get('error_description');

      var card = document.getElementById('card');
      var form = document.getElementById('resetForm');
      var lead = document.getElementById('lead');
      var msg = document.getElementById('message');
      var submitBtn = document.getElementById('submitBtn');

      function showError(text) {
        msg.className = 'message error';
        msg.textContent = text;
      }
      function showSuccess(text) {
        msg.className = 'message success';
        msg.textContent = text;
      }

      // If Supabase returned an error in the hash (expired/invalid link), surface it.
      if (error) {
        card.innerHTML = '<div class="invalid"><h1>Reset link invalid or expired</h1>' +
          '<p class="lead">' + (params.get('error_description') || 'Please request a new password reset email from the app.') + '</p>' +
          '<div class="footer">Email <a href="mailto:support@shepard.love">support@shepard.love</a> if you keep having trouble.</div></div>';
        return;
      }

      // Verify we actually have a recovery token.
      if (!accessToken || type !== 'recovery') {
        card.innerHTML = '<div class="invalid"><h1>Reset link invalid</h1>' +
          '<p class="lead">This page should be opened from the password reset email. ' +
          'If you got here directly, request a new email from the app.</p>' +
          '<div class="footer">Email <a href="mailto:support@shepard.love">support@shepard.love</a> if you keep having trouble.</div></div>';
        return;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var pw = document.getElementById('newPassword').value;
        var confirm = document.getElementById('confirmPassword').value;

        if (pw.length < 8) {
          showError('Password must be at least 8 characters.');
          return;
        }
        if (pw !== confirm) {
          showError('Passwords do not match.');
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating…';
        msg.className = 'message info';
        msg.textContent = '';

        fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken,
          },
          body: JSON.stringify({ password: pw }),
        }).then(function (res) {
          return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
        }).then(function (r) {
          if (r.ok) {
            form.style.display = 'none';
            lead.textContent = 'You can now log in with your new password.';
            showSuccess('Password updated successfully. Open the app and log in.');
            // Wipe the hash from the URL so a back-navigation can't replay
            history.replaceState(null, '', window.location.pathname);
          } else {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update password';
            showError(r.body && r.body.message ? r.body.message : 'Password reset failed. The link may have expired — request a new one from the app.');
          }
        }).catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update password';
          showError('Network error. Please try again.');
        });
      });
    })();
  </script>
</body>
</html>`;

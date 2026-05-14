import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Response } from 'express';
import { PRIVACY_POLICY_HTML } from './privacy-policy.html';
import { TERMS_HTML } from './terms.html';
import { ACCOUNT_DELETION_HTML } from './account-deletion.html';

/**
 * Public legal pages — no auth, no JWT guard.
 *
 * These URLs are registered on the App Store and Play Store consoles
 * (privacy policy and account-deletion are both store requirements).
 * They are also linked from inside the app's Settings screen so users can
 * read them without leaving the experience.
 *
 * The pages are self-contained HTML (no external CSS/JS) so they render
 * reliably even in older browsers and in-app webviews.
 */
@ApiTags('Legal')
@Controller('legal')
export class LegalController {
  @Get('privacy-policy')
  @ApiExcludeEndpoint()
  servePrivacyPolicy(@Res() res: Response) {
    this.respondHtml(res, PRIVACY_POLICY_HTML);
  }

  @Get('terms')
  @ApiExcludeEndpoint()
  serveTerms(@Res() res: Response) {
    this.respondHtml(res, TERMS_HTML);
  }

  @Get('account-deletion')
  @ApiExcludeEndpoint()
  serveAccountDeletion(@Res() res: Response) {
    this.respondHtml(res, ACCOUNT_DELETION_HTML);
  }

  private respondHtml(res: Response, html: string) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Legal text changes rarely but we don't want stale copies pinned in
    // proxies for hours. Five minutes is a reasonable cache window.
    res.setHeader('Cache-Control', 'public, max-age=300');
    // Lock down CSP — these pages inline their <style> blocks but ship no
    // scripts, so script-src is intentionally absent (default-src 'self'
    // applies).
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "form-action 'self' mailto:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join('; '),
    );
    res.send(html);
  }
}

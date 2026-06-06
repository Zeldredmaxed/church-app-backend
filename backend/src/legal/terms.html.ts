// Public terms-of-service page. Served at GET /api/legal/terms.

export const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — Shepard</title>
  <style>
    body { margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2933; max-width: 760px; margin-inline: auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin-top: 32px; }
    h3 { font-size: 17px; margin-top: 20px; margin-bottom: 6px; }
    p, li { font-size: 16px; }
    a { color: #2563eb; }
    .updated { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: June 6, 2026</p>

  <p>By using Shepard you agree to these terms. If you don't agree, please don't use the app. In these terms, "<strong>Shepard</strong>," "we," "our," and "us" refer to <strong>Denzel Christopher Combs</strong>, a sole proprietorship organized under the laws of the State of Indiana, USA, doing business as Shepard.</p>

  <h2>1. Eligibility</h2>
  <p>You must be 13 or older to create or hold a Shepard account. If you are between 13 and 18, your parent or guardian must accept these terms on your behalf. Children under 13 may not create accounts; a parent or guardian may add a child profile to their own account for church check-in purposes (see our Privacy Policy, Section 7).</p>

  <h2>2. Your account</h2>
  <p>You're responsible for keeping your login credentials secure and for any activity on your account. Notify us immediately at <a href="mailto:support@shepard.love">support@shepard.love</a> if you suspect unauthorized access.</p>

  <h2>3. Acceptable use</h2>
  <p>You agree not to:</p>
  <ul>
    <li>Post or share content that is illegal, threatening, harassing, hateful, sexually explicit, or that infringes someone else's rights.</li>
    <li>Impersonate others or misrepresent your affiliation with any person or church.</li>
    <li>Attempt to access data you're not authorized to see, or interfere with the app's security or operation.</li>
    <li>Use the app to send spam or unsolicited bulk communications.</li>
    <li>Upload, embed, stream, or distribute music or other third-party audio for which you do not hold the necessary synchronization, mechanical, performance, and master-use rights. By uploading audio or video content containing music, <strong>you represent and warrant that you have obtained all required licenses and clearances</strong>, and you agree to indemnify Shepard against any claim by a rightsholder arising from your use.</li>
  </ul>

  <h3>3a. Child-safety prohibitions and reporting</h3>
  <p>Shepard has <strong>zero tolerance</strong> for child sexual abuse material ("CSAM") or any content that sexualizes minors, and for grooming, solicitation, or other predatory behavior directed at minors. The following are <strong>strictly prohibited</strong> and will result in immediate account termination, content removal, and a report to the National Center for Missing &amp; Exploited Children (NCMEC) and to law enforcement as required by law (18 U.S.C. § 2258A):</p>
  <ul>
    <li>Uploading, sharing, requesting, or linking to child sexual abuse material in any form.</li>
    <li>Sexual or sexualized communication with a person you know or have reason to believe is under 18.</li>
    <li>Grooming behavior — building trust with a minor for the purpose of sexual exploitation, including coercion, manipulation, or attempts to move communication off-platform to evade safeguards.</li>
    <li>Sharing a minor's personal contact information, location, or images without the verifiable consent of a parent or guardian.</li>
  </ul>
  <p>Every user has access to in-app <strong>flag</strong> and <strong>block</strong> tools on profiles, posts, comments, chat messages, and direct conversations. Reports of objectionable content or abusive users — and especially any report alleging child endangerment, CSAM, or grooming — are reviewed and acted upon within a target of <strong>24 hours</strong>. Confirmed child-safety violations are escalated to NCMEC's CyberTipline and to appropriate law-enforcement authorities.</p>

  <p>We can remove content and suspend accounts that violate these rules.</p>

  <h2>4. Your content</h2>
  <p>You keep ownership of what you post on Shepard. By submitting, uploading, transmitting, or displaying content through the service ("User Content"), you grant Shepard a <strong>worldwide, non-exclusive, royalty-free, sublicensable, and transferable license</strong> to host, store, cache, reproduce, transcode, re-encode, adapt, modify (for technical purposes such as resizing, format conversion, and thumbnail generation), create derivative copies of, distribute, and display your User Content, in any media now known or later developed, for the limited purposes of operating, providing, securing, improving, and promoting the Shepard service.</p>
  <p>This license includes the right to sublicense the foregoing rights to our service providers (including, without limitation, <strong>Mux</strong> for video transcoding and delivery, <strong>AWS S3</strong> for object storage, and <strong>Stripe</strong> for payment-related content), strictly for the purpose of providing the service to you and your church. This license terminates when you delete your User Content or your account, except (a) for content others have copied or shared before deletion, (b) for content reasonably retained in backups for the periods described in our Privacy Policy, and (c) to the extent retention is required to comply with law.</p>

  <h2>5. Donations</h2>
  <p>Donations are processed by Stripe. Once submitted, donations are typically non-refundable. Contact your church's administrator for refund requests. Tax receipts are issued by each church directly.</p>
  <p><strong>Tax-deductibility disclaimer.</strong> Whether your donation is tax-deductible depends on the recipient church's tax-exempt status (for example, recognition as an organization described in Section 501(c)(3) of the U.S. Internal Revenue Code) and on your personal tax situation. <strong>Shepard does not, and cannot, determine the tax-exempt status of any recipient church and does not provide tax, legal, or accounting advice.</strong> Receipts and acknowledgements issued through the platform are generated by the recipient church, not by Shepard. Please consult a qualified tax professional and confirm the church's exempt status with the IRS (or your local equivalent) before claiming any deduction.</p>

  <h2>6. Subscriptions (churches only)</h2>
  <p>If your church subscribes to a paid tier, the church (not individual members) is the billing party. Subscriptions auto-renew until cancelled. The church administrator can cancel at any time in the church settings.</p>

  <h2>7. Child check-in and pickup</h2>
  <p>Shepard's child check-in feature is a <strong>record-keeping and administrative tool</strong> intended to help church staff track which children are signed in to a kids' ministry program and who has been listed by a guardian as an authorized pickup. <strong>It is not a security system, surveillance system, access-control system, or substitute for in-person supervision.</strong></p>
  <p>The church and its staff and volunteers — not Shepard — are responsible for verifying the identity of the person picking up a child, supervising children while in the church's care, and complying with all applicable child-protection laws and policies. Parents and guardians are responsible for accurately maintaining the authorized-pickup list for their child profiles and for the conduct of the persons they authorize. To the maximum extent permitted by law, Shepard disclaims all liability arising from the misuse of the check-in feature, including unauthorized pickup, mistaken identity, or any harm to a child while in the church's care.</p>

  <h2>8. Disclaimers</h2>
  <p>The app is provided "as is" and "as available" without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, and accuracy. We don't guarantee uninterrupted availability or that the app will be error-free.</p>

  <h2>9. Limitation of liability</h2>
  <p>To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, punitive, or exemplary damages, or for any loss of profits, revenues, data, or goodwill, arising from your use of the app, even if we have been advised of the possibility of such damages. Our aggregate liability for any claim arising out of or relating to these terms or the service will not exceed the greater of (a) the fees paid to us by you (if any) in the 12 months preceding the claim and (b) US$100.</p>

  <h2>10. Copyright — DMCA</h2>
  <p>Shepard respects the intellectual-property rights of others and complies with the U.S. Digital Millennium Copyright Act, 17 U.S.C. § 512 ("DMCA"). If you believe in good faith that material accessible on or from Shepard infringes your copyright, send a written notice to our designated agent at <a href="mailto:copyright@shepard.love">copyright@shepard.love</a>. To be effective under the DMCA, your notice must include all six elements required by 17 U.S.C. § 512(c)(3)(A):</p>
  <ol>
    <li>A physical or electronic signature of a person authorized to act on behalf of the owner of the exclusive right that is allegedly infringed.</li>
    <li>Identification of the copyrighted work claimed to have been infringed (or, if multiple works, a representative list).</li>
    <li>Identification of the material claimed to be infringing or to be the subject of infringing activity, with information reasonably sufficient to permit us to locate it (such as the URL or in-app location).</li>
    <li>Information reasonably sufficient to permit us to contact you — address, telephone number, and email address.</li>
    <li>A statement that you have a good-faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.</li>
    <li>A statement that the information in the notification is accurate, and under penalty of perjury, that you are authorized to act on behalf of the owner of the exclusive right allegedly infringed.</li>
  </ol>
  <p>We aim to acknowledge and act on properly formed DMCA notices within <strong>7 business days</strong>. Counter-notifications under 17 U.S.C. § 512(g) may be sent to the same address. We may terminate the accounts of users determined to be repeat infringers.</p>

  <h2>11. Changes</h2>
  <p>We may update these terms. If we make material changes, we'll notify you in-app and/or by email. Your continued use after changes constitutes acceptance.</p>

  <h2>12. Governing law, dispute resolution, and class-action waiver</h2>
  <p><strong>Governing law.</strong> These terms and any dispute arising out of or relating to them or to the Shepard service are governed by the laws of the <strong>State of Indiana, USA</strong>, without regard to its conflict-of-laws principles. The United Nations Convention on Contracts for the International Sale of Goods does not apply.</p>
  <p><strong>Venue.</strong> Subject to the informal-resolution requirement below, you and Shepard agree that the exclusive venue for any judicial proceeding will be the state or federal courts located in <strong>Marion County, Indiana</strong>, and each party consents to personal jurisdiction there.</p>
  <p><strong>Informal resolution.</strong> Before filing a lawsuit, you agree to first contact us at <a href="mailto:legal@shepard.love">legal@shepard.love</a> with a written description of the dispute and to negotiate informally in good faith for <strong>at least 60 days</strong>. Neither party may commence a formal proceeding until this 60-day period has elapsed (the limitations period is tolled during the 60 days).</p>
  <p><strong>Class-action waiver.</strong> To the maximum extent permitted by law, you and Shepard each agree that any dispute will be brought in your or our individual capacity, and <strong>not as a plaintiff or class member in any purported class, collective, consolidated, or representative action</strong>. You and Shepard each waive any right to a jury trial. If a court finds the class-action waiver unenforceable as to a particular claim, that claim (and only that claim) must be severed and brought in court, with the remainder of this section remaining in force.</p>

  <h2>13. Contact</h2>
  <p>Questions: <a href="mailto:support@shepard.love">support@shepard.love</a></p>
</body>
</html>`;

/** Sample inbound mail for the tests, written the way the real job systems send it. `{{to}}` is replaced by the test's inbox address. */

const mime = (headers: string[], body: string): string => `${headers.join("\r\n")}\r\n\r\n${body}`.replace(/\r?\n/g, "\r\n");

export const GREENHOUSE_CODE = mime([
  "From: Acme Robotics via Greenhouse <no-reply@us.greenhouse-mail.io>",
  "To: Ada Lovelace <{{to}}>",
  "Subject: Security code for your application to Acme Robotics",
  "Message-ID: <gh-code-1@us.greenhouse-mail.io>",
  "Date: Fri, 30 Oct 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hi Ada,

Thanks for your interest in the Senior Backend Engineer role at Acme Robotics.

Copy and paste this code into the first field of your application:

aB3dE9xK

After you enter the code, you can submit your application.

If you didn't request this code you can ignore this message.
`);

export const GREENHOUSE_CONFIRMATION = mime([
  "From: Acme Robotics <no-reply@us.greenhouse-mail.io>",
  "To: {{to}}",
  "Subject: Thank you for applying to Acme Robotics",
  "Message-ID: <gh-confirm-1@us.greenhouse-mail.io>",
  "Date: Fri, 30 Oct 2026 10:05:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
], `<html><body><p>Hi Ada,</p><p>Thank you for applying to the <b>Senior Backend Engineer</b> position at Acme Robotics.
We have received your application and our team will review it. If your background is a match we will be in touch to schedule an interview.</p>
<p><a href="https://acme.example/careers">See other roles</a></p>
<p><a href="https://greenhouse-mail.io/unsubscribe?x=1">Unsubscribe</a></p></body></html>`);

export const WORKDAY_VERIFY = mime([
  "From: Globex Careers <globex@myworkday.com>",
  "To: {{to}}",
  "Subject: Verify your email address",
  "Message-ID: <wd-verify-1@myworkday.com>",
  "Date: Fri, 30 Oct 2026 11:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Welcome to the Globex Corporation careers site.

Please verify your account by clicking the link below:

https://wd5.myworkdaysite.com/en-US/globex/verify?token=7f3a9c1e&email=nori-test

If you did not create this account, ignore this message.
https://wd5.myworkdaysite.com/en-US/globex/unsubscribe
`);

export const WORKDAY_CONFIRMATION = mime([
  "From: Globex Corporation <globex@myworkday.com>",
  "To: {{to}}",
  "Subject: Thank you for applying - Data Analyst (R-1204)",
  "Message-ID: <wd-confirm-1@myworkday.com>",
  "Date: Fri, 30 Oct 2026 11:20:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hello Ada,

Thank you for applying to Data Analyst (R-1204) at Globex Corporation. We have received your application.
A recruiter will reach out to schedule an interview if your qualifications match.
`);

export const LEVER_CODE = mime([
  "From: Initech <no-reply@hire.lever.co>",
  "To: {{to}}",
  "Subject: Your Initech verification code",
  "Message-ID: <lever-code-1@hire.lever.co>",
  "Date: Fri, 30 Oct 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Your verification code is 482913. It expires in 10 minutes.

Enter it on the application page to continue.
`);

export const LEVER_CONFIRMATION = mime([
  "From: Initech <no-reply@hire.lever.co>",
  "To: {{to}}",
  "Subject: Thanks for applying to Initech",
  "Message-ID: <lever-confirm-1@hire.lever.co>",
  "Date: Fri, 30 Oct 2026 12:03:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hi Ada,

We received your application for Platform Engineer and will be in touch if there is a fit.

Best,
The Initech team
`);

export const REJECTION = mime([
  "From: Acme Robotics <recruiting@acmerobotics.com>",
  "To: {{to}}",
  "Subject: Your application to Acme Robotics",
  "Message-ID: <acme-reject-1@acmerobotics.com>",
  "Date: Mon, 02 Nov 2026 09:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hi Ada,

Thank you for your interest in the Senior Backend Engineer role. Unfortunately we have decided not to move forward with your application at this time.

Best wishes,
Acme Robotics Recruiting
`);

export const INTERVIEW = mime([
  "From: Priya Shah <priya@acmerobotics.com>",
  "To: {{to}}",
  "Subject: Interview with Acme Robotics",
  "Message-ID: <acme-interview-1@acmerobotics.com>",
  "Date: Mon, 02 Nov 2026 09:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hi Ada,

I'm a recruiter at Acme Robotics. We'd like to invite you to an interview for the Senior Backend Engineer role. Could you share your availability this week?

Priya
`);

export const RECRUITER_REPLY = mime([
  "From: Sam Lee <sam@initech.com>",
  "To: {{to}}",
  "Subject: Quick question about your application",
  "Message-ID: <initech-reply-1@initech.com>",
  "Date: Mon, 02 Nov 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hi Ada,

I'm on the hiring team at Initech and saw your application for the Platform Engineer position. Are you open to a hybrid setup?

Sam
`);

/** Someone who only knows the company name writing from an unrelated domain. */
export const FAKE_REJECTION = mime([
  "From: Totally Legit <hr@sketchy-example.net>",
  "To: {{to}}",
  "Subject: Acme Robotics update on your application",
  "Message-ID: <fake-1@sketchy-example.net>",
  "Date: Mon, 02 Nov 2026 11:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Unfortunately Acme Robotics will not be moving forward with you. Click here to appeal.`);

export const withTo = (raw: string, to: string): string => raw.replaceAll("{{to}}", to);

export const postmarkPayload = (to: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  From: "Initech <no-reply@hire.lever.co>",
  FromFull: { Email: "no-reply@hire.lever.co", Name: "Initech" },
  To: to,
  ToFull: [{ Email: to, Name: "" }],
  OriginalRecipient: to,
  Subject: "Your Initech verification code",
  MessageID: "6a1c7e9e-0b3f-4c52-9d3f-pm-1",
  Date: "Fri, 30 Oct 2026 12:00:00 +0000",
  TextBody: "Your verification code is 731942. It expires in 10 minutes.",
  HtmlBody: "<p>Your verification code is <b>731942</b>.</p>",
  Headers: [{ Name: "Message-ID", Value: "<pm-1@hire.lever.co>" }],
  ...over,
});

export const genericPayload = (to: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  from: "Initech <no-reply@hire.lever.co>",
  to,
  subject: "Your Initech verification code",
  text: "Your verification code is 905511.",
  messageId: "generic-1",
  ...over,
});

// ---- more synthetic mail (no real messages) -------------------------------------------------------------------------

/** Greenhouse's bot check: the code mail as HTML only, with a tracking pixel and a footer full of numbers. */
export const GREENHOUSE_CODE_HTML = mime([
  "From: Greenhouse <no-reply@us.greenhouse-mail.io>",
  "To: {{to}}",
  "Subject: Security code for your application to Pied Piper",
  "Message-ID: <gh-code-html-1@us.greenhouse-mail.io>",
  "Date: Sat, 31 Oct 2026 09:00:00 +0000",
  "Authentication-Results: mx.example; spf=pass smtp.mailfrom=greenhouse-mail.io; dkim=pass header.d=greenhouse-mail.io; dmarc=pass",
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=utf-8",
], `<html><head><style>p{color:#333}</style></head><body>
<p>Hi Ada,</p>
<p>Copy and paste this code into the security code field on your application for Staff Engineer (Req 4471) at Pied Piper:</p>
<p style="font-size:24px"><b>Xk7Pq2Lm</b></p>
<p>This code expires in 15 minutes. Posted on 10/30/2026.</p>
<p>Greenhouse Software, 228 Park Ave S, New York, NY 10003. Call +1 (415) 555-0137.</p>
<img src="https://us.greenhouse-mail.io/wf/open?upn=abc123" width="1" height="1" alt="">
</body></html>`);

export const ASHBY_CONFIRMATION = mime([
  "From: Hooli Recruiting <no-reply@ashbyhq.com>",
  "To: {{to}}",
  "Subject: Thanks for applying to Hooli!",
  "Message-ID: <ashby-confirm-1@ashbyhq.com>",
  "Date: Sat, 31 Oct 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: multipart/alternative; boundary=\"b1\"",
], `--b1
Content-Type: text/plain; charset=utf-8

Hi Ada,

Thanks for applying for the Product Designer role at Hooli. Our team will review your application and get back to you.
You can check the status at https://jobs.ashbyhq.com/hooli/7c1e9b52-3f0a-4d7e-9a1b-2c3d4e5f6a7b/application?utm_source=email

Hooli Recruiting
--b1
Content-Type: application/pdf; name="Ada_Lovelace_Resume.pdf"
Content-Disposition: attachment; filename="Ada_Lovelace_Resume.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK
--b1--
`);

/** Workday tenant account creation: verify by link, plus a candidate reference number that is not a code. */
export const WORKDAY_ACCOUNT = mime([
  "From: Umbrella Careers <umbrella@myworkday.com>",
  "To: {{to}}",
  "Subject: Please verify your candidate account",
  "Message-ID: <wd-account-1@myworkday.com>",
  "Date: Sat, 31 Oct 2026 11:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hello,

Thank you for creating a candidate account with Umbrella Corporation. Candidate ID: 2209183.
To complete your registration, click the link below to verify your email address:

https://umbrella.wd1.myworkdayjobs.com/en-US/External/activate/9f8e7d6c5b4a?redirect=%2Fjob%2FR-88213

This link expires in 24 hours.
`);

export const CALENDLY_INTERVIEW = mime([
  "From: Jordan Park <jordan.park@hooli.com>",
  "To: {{to}}",
  "Subject: Next steps - Product Designer at Hooli",
  "Message-ID: <hooli-interview-1@hooli.com>",
  "Date: Mon, 02 Nov 2026 15:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Hi Ada,

Thanks for your application for the Product Designer role. We'd love to schedule a 30 minute phone screen with you.
Please pick a time that works for you here: https://calendly.com/jordan-park-hooli/30min

Looking forward to it,
Jordan Park, Talent Partner, Hooli
`);

export const NEWSLETTER = mime([
  "From: Career Weekly <newsletter@careerweekly.example>",
  "To: {{to}}",
  "Subject: 5 tips to get past the bot check in 2026",
  "Message-ID: <cw-2026-44@careerweekly.example>",
  "Date: Sun, 01 Nov 2026 08:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Career Weekly - Issue 1044

Recruiters read 250 applications per role. Use promo code SAVE2026 for 20% off our resume course.
Our code of conduct: be kind. Call 1-800-555-0199, or visit us at 500 Market St, San Francisco, CA 94105.
Over 31337 readers got a security clearance job last year!

Unsubscribe: https://careerweekly.example/unsubscribe?u=4471
`);

export const ORDER_RECEIPT = mime([
  "From: Shop <orders@shop.example>",
  "To: {{to}}",
  "Subject: Your order #448812 has shipped",
  "Message-ID: <order-448812@shop.example>",
  "Date: Sun, 01 Nov 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
], `Thanks for your order!

Order number: 448812
Total: $129.99
Tracking number: 1Z999AA10123456784
Your confirmation code for returns is listed on the packing slip.
Delivered by 11/04/2026.
`);

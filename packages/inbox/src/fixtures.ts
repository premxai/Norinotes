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

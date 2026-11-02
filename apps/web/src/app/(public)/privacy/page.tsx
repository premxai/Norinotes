import type { Metadata } from "next";
import { CONTACT, Prose, REPO_URL } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Norinote stores about you, who it is shared with, and how to export or delete it.",
};

export default function PrivacyPage() {
  return (
    <Prose title="Privacy" updated="20 October 2026">
      <section>
        <p>Norinote helps you search and apply for jobs. To do that it needs your work history, so this page says plainly what is stored, where it goes, and how you remove it.</p>
      </section>

      <section>
        <h2>What Norinote stores</h2>
        <ul>
          <li><strong>Your account:</strong> email address, name, and a salted hash of your password (never the password itself).</li>
          <li><strong>Your career graph and resumes:</strong> the text and facts read from the resume you add, and every tailored version with the reasons for each change.</li>
          <li><strong>Your preferences and answers:</strong> job titles, locations, salary and work-authorisation answers, and the answers you give to application questions.</li>
          <li><strong>Your Norinote inbox:</strong> mail sent to your Norinote address that is about your job search (verification codes, confirmations, replies), and the Telegram chat you link, if you link one.</li>
          <li><strong>Your applications:</strong> the jobs you apply to, the form fields Norinote filled, screenshots of the filled form (deleted 30 days after the application is settled), and the status of each application.</li>
          <li><strong>Sign-in sessions:</strong> a random token in a cookie. Only a hash of it is stored, together with your browser&apos;s user-agent text so you can recognise a device and sign it out in Settings.</li>
        </ul>
      </section>

      <section>
        <h2>Who else sees it</h2>
        <p>Norinote does not sell your data and does not show advertising. Parts of your data leave Norinote only when a feature needs another service:</p>
        <ul>
          <li><strong>The language model.</strong> When tailoring, answering questions or reading a resume uses a hosted model, the relevant text is sent to the model provider the operator of this site has chosen.</li>
          <li><strong>Job boards and company pages.</strong> Norinote reads public job postings. When you approve an application, the form is filled on the employer&apos;s own site and the information you approved is sent to that employer, as if you had typed it.</li>
          <li><strong>Email delivery.</strong> Account emails (confirm your address, reset your password) are sent through an email provider.</li>
          <li><strong>Hosting.</strong> The app and its database run with the hosting providers the operator of this site has chosen.</li>
        </ul>
      </section>

      <section>
        <h2>Nothing is sent without you</h2>
        <p>Norinote prepares each application ahead of time, and nothing is submitted until you click Apply and approve it. If you set a daily cap above zero in Settings, it may send that many a day on its own, and you can set it back to zero at any time.</p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>Norinote sets one cookie, which keeps you signed in. It does not use advertising or cross-site tracking cookies.</p>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul>
          <li><strong>Resumes:</strong> every tailored resume can be opened and downloaded as a PDF.</li>
          <li><strong>Delete:</strong> Settings, Delete account, removes your account and everything keyed to it: graph, resumes, applications, inbox and linked Telegram chat. It cannot be undone.</li>
          <li><strong>Sign out everywhere:</strong> Settings, Security, lists your signed-in devices and signs the others out.</li>
        </ul>
      </section>

      <section>
        <h2>Questions</h2>
        <p>
          {CONTACT ? <>Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</> : REPO_URL ? <>Open an issue in the <a href={REPO_URL} target="_blank" rel="noreferrer">project repository</a>.</> : <>Contact the people who run this Norinote server.</>}
        </p>
      </section>
    </Prose>
  );
}

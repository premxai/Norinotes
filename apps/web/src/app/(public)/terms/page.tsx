import type { Metadata } from "next";
import { CONTACT, Prose, REPO_URL } from "@/components/public/Chrome";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Norinote.",
};

export default function TermsPage() {
  return (
    <Prose title="Terms of use" updated="20 October 2026">
      <section>
        <p>By creating an account or using Norinote you agree to these terms. They are short on purpose.</p>
      </section>

      <section>
        <h2>What Norinote is</h2>
        <p>Norinote is a tool that helps you find jobs, prepare resumes and fill in applications. It acts on your behalf only within what you approve. It is not a recruiter, an employer or an employment agency, and it does not promise interviews or offers.</p>
      </section>

      <section>
        <h2>Your responsibilities</h2>
        <ul>
          <li>Give accurate information. Norinote writes resumes from the facts you provide and does not invent new ones; you are responsible for what you approve and send.</li>
          <li>Review the resume and form before you approve them. Check anything that matters, such as dates, titles and work-authorisation answers.</li>
          <li>Follow the rules of the sites and employers you apply to. Do not use Norinote to spam, to apply on behalf of someone else without their consent, or to get around a site&apos;s security.</li>
          <li>Keep your password and the keys you add to Settings private.</li>
        </ul>
      </section>

      <section>
        <h2>Automation limits</h2>
        <p>Norinote fills forms automatically, which can fail when a site changes. When it cannot continue it stops and tells you instead of guessing. It does not solve CAPTCHAs. If an application stops, you can take it over on the employer&apos;s own site.</p>
      </section>

      <section>
        <h2>Models and third parties</h2>
        <p>Parts of Norinote use language models and other services. Their output can be wrong. Norinote checks tailored resume lines against the evidence in your career graph, but you remain the final reviewer. See the <a href="/privacy">privacy page</a> for what is shared with whom.</p>
      </section>

      <section>
        <h2>Your content</h2>
        <p>Your resume, answers and documents stay yours. You allow Norinote to store and process them to provide the features you use. You can export or delete them at any time.</p>
      </section>

      <section>
        <h2>No warranty, limited liability</h2>
        <p>Norinote is provided as is, without warranties of any kind. To the extent the law allows, the people who run and build Norinote are not liable for lost opportunities, rejected applications or indirect losses from using it.</p>
      </section>

      <section>
        <h2>Ending your use</h2>
        <p>You can delete your account in Settings at any time. We may suspend accounts that abuse the service or the sites it applies to.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          If these terms change, the date above changes with them. Questions:{" "}
          {CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : REPO_URL ? <>open an issue in the <a href={REPO_URL} target="_blank" rel="noreferrer">project repository</a></> : <>contact the people who run this Norinote server</>}.
        </p>
      </section>
    </Prose>
  );
}

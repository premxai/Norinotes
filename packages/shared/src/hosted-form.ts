/**
 * A form Nori can fill. For Greenhouse that means the posting lives on Greenhouse's own job board; a company that keeps
 * its postings on its own site embeds the form there, and Nori never fills embedded forms.
 */
export const HOSTED_GREENHOUSE_URL = /^https?:\/\/(job-boards|boards)(\.eu)?\.greenhouse\.io\//i;

export function isHostedForm(atsType: string, applyUrl: string): boolean {
  return atsType !== "greenhouse" || HOSTED_GREENHOUSE_URL.test(applyUrl);
}

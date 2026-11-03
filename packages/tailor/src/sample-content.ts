import type { ResumeBullet, ResumeContent } from "./types.js";

/** Adapter from the source format's bare bullets: explicit weights give the fitter an order to cut by. */
const b = (id: string, text: string, weight = 1): ResumeBullet => ({ id, text, careerPointIds: [id], weight });

/** A believable mid-career resume: the sample the template snapshot and the sample PDF are made from. */
export const SAMPLE_RESUME: ResumeContent = {
  name: "Alex Morgan",
  contact: { email: "alex.morgan@example.com", phone: "(415) 555-0134", location: "San Francisco, CA", linkedin: "linkedin.com/in/alexmorgan", github: "github.com/alexmorgan", website: "alexmorgan.example.com" },
  summary: "Product-minded software engineer with seven years building data-heavy web applications in TypeScript and Python. Led a team of five and shipped features used by two million people.",
  experience: [
    {
      careerPointId: "e0", title: "Senior Software Engineer", company: "Northwind Labs", location: "San Francisco, CA", start: "2022-03", end: "Present",
      bullets: [
        b("e0-b0", "Led the migration of the checkout flow to React and TypeScript, cutting page load time by 45% for 2M monthly users", 3),
        b("e0-b1", "Built a Node.js and PostgreSQL billing service that processes $12M in annual payments with 99.98% uptime", 2),
        b("e0-b2", "Mentored four engineers and introduced design reviews that reduced rework by a third", 1),
      ],
    },
    {
      careerPointId: "e1", title: "Software Engineer", company: "Brightside Analytics", location: "Seattle, WA", start: "2019-06", end: "2022-02",
      bullets: [
        b("e1-b0", "Developed a Python and Airflow pipeline ingesting 2M events per day with automated data-quality checks", 2),
        b("e1-b1", "Reduced warehouse query costs by 31% by redesigning partitioning and caching hot aggregates", 1.5),
        b("e1-b2", "Shipped a self-serve reporting tool adopted by 120 internal users within the first quarter", 1),
      ],
    },
    {
      careerPointId: "e2", title: "Junior Developer", company: "Copperline", location: "Austin, TX", start: "2017-07", end: "2019-05",
      bullets: [b("e2-b0", "Wrote REST APIs in Express and added integration tests that caught regressions before release", 1)],
    },
  ],
  education: [{ careerPointId: "ed0", school: "University of Washington", degree: "B.S.", field: "Computer Science", start: "2013", end: "2017" }],
  skills: [
    { group: "Languages", items: ["TypeScript", "Python", "SQL", "Go"] },
    { group: "Frameworks", items: ["React", "Next.js", "Node.js", "Express", "Airflow"] },
    { group: "Infrastructure", items: ["PostgreSQL", "Docker", "AWS", "Terraform"] },
  ],
  projects: [{ careerPointId: "p0", name: "Open-source charts library", bullets: [b("p0-b0", "Created a 3kB accessible charting library for React with 2,100 GitHub stars and 40 contributors", 0.5)] }],
  certifications: ["AWS Certified Developer - Associate"],
};

/** Twelve years, six roles: stresses the fitter. */
export function longResume(): ResumeContent {
  const roles = ["Principal Engineer", "Staff Engineer", "Senior Engineer", "Engineer", "Associate Engineer", "Intern"];
  const cos = ["Helix Cloud", "Orbit Payments", "Lumen Analytics", "Brightpath", "Copperline", "Northwind"];
  return {
    ...SAMPLE_RESUME,
    experience: roles.map((title, i) => ({
      careerPointId: `l${i}`, title, company: cos[i]!, location: "Remote", start: `${2024 - 2 * (i + 1)}-01`, end: i === 0 ? "Present" : `${2024 - 2 * i}-01`,
      bullets: [0, 1, 2, 3, 4].map((k) => b(`l${i}-${k}`, `Delivered measurable improvements to ${cos[i]} platform reliability and performance, number ${k + 1}, saving the team ${10 + k} hours every week`, 5 - k)),
    })),
  };
}

/** One role, a degree: a student or career changer. */
export const STUDENT_RESUME: ResumeContent = {
  name: "Priya Raman",
  contact: { email: "priya.raman@example.edu", phone: "617-555-0172", location: "Boston, MA", linkedin: "linkedin.com/in/priyaraman" },
  experience: [
    {
      careerPointId: "s", title: "Software Engineering Intern", company: "Acme Robotics", location: "Boston, MA", start: "2025-06", end: "2025-08",
      bullets: [b("s0", "Built a telemetry dashboard in React that cut debugging time for the controls team by 30%", 2), b("s1", "Wrote Python scripts that automated nightly simulation reports for twelve engineers", 1)],
    },
  ],
  education: [{ careerPointId: "se", school: "Northeastern University", degree: "B.S.", field: "Computer Science", start: "2022", end: "2026" }],
  skills: [{ group: "Languages", items: ["Python", "TypeScript", "C++", "SQL"] }, { group: "Tools", items: ["Git", "Docker", "Linux"] }],
  projects: [{ careerPointId: "sp", name: "Campus ride-share app", bullets: [b("sp0", "Designed and shipped an iOS and web app used by 800 students in its first semester", 1)] }],
};

/** Accents, ampersands and long strings: checks escaping, fonts and wrapping. */
export const UNICODE_RESUME: ResumeContent = {
  name: "Łukasz Żółkiewski-Núñez",
  contact: { email: "lukasz@example.pl", phone: "+48 600 700 800", location: "Kraków, Polska", website: "https://lukasz.example.pl/portfolio" },
  summary: "Ingénieur logiciel & chef d'équipe: R&D, <data> pipelines, and “smart quotes” — résumé naïve café.",
  experience: [
    {
      careerPointId: "u", title: "Lead Engineer, Platform & Reliability", company: "Zażółć Gęślą Jaźń Sp. z o.o.", location: "Kraków", start: "2020-01", end: "Present",
      bullets: [b("u0", "Reduced p99 latency from 480ms to 120ms by adding connection pooling & circuit breakers across 40 services", 2), b("u1", "Coordinated a 14-person team across three time zones to deliver the ERP migration on schedule and under budget", 1)],
    },
  ],
  education: [{ careerPointId: "ue", school: "Politechnika Krakowska", degree: "M.Sc.", field: "Informatyka", start: "2012", end: "2017" }],
  skills: [{ group: "Technologies", items: ["Go", "Kubernetes", "PostgreSQL", "gRPC", "Terraform"] }],
  projects: [],
};

export const SAMPLE_PERSONAS = { sample: SAMPLE_RESUME, long: longResume(), student: STUDENT_RESUME, unicode: UNICODE_RESUME } as const;

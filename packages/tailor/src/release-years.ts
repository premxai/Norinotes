/**
 * First public release year of common tools, so a rewrite cannot put a tool into a role that ended before it existed
 * ("used Kubernetes" in a 2012 role). Lenient on purpose: the year of the first public (often beta) release.
 * Keys are alias-table canonical keys (see aliases.ts) or plain lower-cased names.
 */
export const RELEASE_YEARS: Readonly<Record<string, number>> = {
  "react": 2013, "react native": 2015, "vue.js": 2014, "angular": 2016, "angularjs": 2010, "svelte": 2016, "next.js": 2016,
  "node.js": 2009, "typescript": 2012, "go": 2009, "rust": 2015, "kotlin": 2016, "swift": 2014, "swiftui": 2019, "flutter": 2017,
  "docker": 2013, "kubernetes": 2014, "helm": 2016, "terraform": 2014, "ansible": 2012, "pulumi": 2018, "github actions": 2019,
  "gitlab ci": 2015, "jenkins": 2011, "circleci": 2011, "kafka": 2011, "redis": 2009, "mongodb": 2009, "elasticsearch": 2010,
  "cassandra": 2008, "dynamodb": 2012, "snowflake": 2014, "bigquery": 2010, "databricks": 2013, "spark": 2010, "airflow": 2015,
  "dbt": 2016, "looker": 2012, "power bi": 2013, "figma": 2016, "sketch": 2010, "graphql": 2015, "grpc": 2016, "fastapi": 2018,
  "flask": 2010, "django": 2005, "ruby on rails": 2004, "spring boot": 2014, "nestjs": 2017, "pytorch": 2016, "tensorflow": 2015,
  "keras": 2015, "scikit-learn": 2007, "pandas": 2008, "hugging face": 2016, "langchain": 2022, "openai api": 2020,
  "large language models": 2018, "generative ai": 2014, "retrieval-augmented generation": 2020, "mlops": 2015, "playwright": 2020,
  "cypress": 2015, "jest": 2014, "vite": 2020, "webpack": 2012, "tailwind css": 2017, "redux": 2015, "storybook": 2016,
  "prometheus": 2012, "grafana": 2014, "datadog": 2010, "aws lambda": 2014, "amazon eks": 2018, "amazon ecs": 2014,
  "google kubernetes engine": 2015, "microsoft azure": 2010, "google cloud platform": 2008, "amazon s3": 2006, "amazon ec2": 2006,
  "amazon rds": 2009, "amazon sqs": 2004, "aws": 2006, "github": 2008, "jira": 2002, "confluence": 2004, "salesforce": 1999,
  "hubspot": 2006, "amplitude": 2012, "mixpanel": 2009, "google analytics": 2005, "netsuite": 1998, "quickbooks": 1992,
  "tableau": 2003, "epic": 1979, "pyxis": 1987, "cerner": 1979, "soc 2": 2010, "wcag": 1999, "ios": 2007, "android": 2008,
  "unity": 2005, "pyspark": 2013, "apache flink": 2011, "sqlite": 2000, "postgresql": 1996, "mysql": 1995, "selenium": 2004,
  "pytest": 2004, "junit": 1997, "sass": 2006, "chatgpt": 2022, "github copilot": 2021, "copilot": 2021, "gpt-4": 2023, "claude": 2023,
  "deno": 2018, "bun": 2022, "supabase": 2020, "vercel": 2015, "firebase": 2012, "istio": 2017, "argo cd": 2018, "fivetran": 2012,
  "segment": 2012, "slack": 2013, "notion": 2016, "zoom": 2013, "microsoft teams": 2017, "tiktok": 2016, "gong": 2015, "outreach": 2014,
};

/** The release year of a tool, or null when the table does not know it. */
export function releaseYearOf(key: string): number | null {
  return RELEASE_YEARS[key.toLowerCase()] ?? null;
}

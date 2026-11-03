/**
 * Requirement normalisation: one line per term, the canonical name first, then the names and acronyms that mean exactly
 * the same thing. Used to match job requirements to career points, to score coverage, and by the gate (a rewrite may say
 * "Kubernetes" when the source says "K8s", never when the source says neither).
 *
 * Line format: `Canonical | alias; alias; ~Alias`. A name starting with `~` matches case-sensitively, for short names that
 * are also ordinary words or letters (Go, R, ED, Epic, Excel). Keep groups strict: only true synonyms, never "related"
 * skills (Docker is not Kubernetes, Postgres is not SQL Server), because a group lets a rewrite swap one name for another.
 */
export const ALIAS_TABLE = `
JavaScript | js; ecmascript; es6
TypeScript | ~TS
Python | python3; python 3
~Go | golang; go lang
C++ | cpp; c plus plus
C# | csharp; c sharp
Java | java se; java ee
Kotlin |
~Swift |
~Rust |
~Ruby |
PHP |
Scala |
~R | r programming; r language
SQL | structured query language
NoSQL | no-sql
Bash | shell scripting; bash scripting
PowerShell | power shell
HTML | html5
CSS | css3
Sass | scss
React | react.js; reactjs; react js
React Native | react-native
Next.js | nextjs; next js
Vue.js | vue; vuejs; vue js
Angular | angular 2+
AngularJS | angular.js
Svelte | sveltekit
Redux | redux toolkit
Tailwind CSS | tailwind; tailwindcss
jQuery |
Webpack |
Vite |
Storybook |
Node.js | nodejs; node js; ~Node
~Express | express.js; expressjs
NestJS | nest.js
Django |
~Flask |
FastAPI | fast api
Spring Boot | springboot
.NET | dotnet; .net core; asp.net; asp.net core
Ruby on Rails | rails; ror
GraphQL |
REST APIs | ~REST; restful; rest api; restful api; restful apis; restful services; rest services
gRPC | grpc
API | apis; application programming interface; application programming interfaces
SDK | sdks; software development kit
CLI | command-line interface; command line interface
Microservices | microservice; micro-services; microservices architecture
Event-Driven Architecture | event-driven; event driven; event driven architecture
Distributed Systems | distributed system
System Design | systems design
WebSockets | websocket; web sockets
Object-Oriented Programming | oop; object oriented programming
Test-Driven Development | tdd; test driven development
Unit Testing | unit tests; unit test
Jest |
Cypress |
Playwright |
Selenium |
pytest |
JUnit |
PostgreSQL | postgres; psql
MySQL |
SQL Server | microsoft sql server; mssql; ms sql
Oracle Database | oracle db
MongoDB | mongo
Redis |
Elasticsearch | elastic search
Cassandra | apache cassandra
DynamoDB | dynamo db; amazon dynamodb
SQLite |
Kafka | apache kafka
RabbitMQ | rabbit mq
AWS | amazon web services
Google Cloud Platform | gcp; google cloud
Microsoft Azure | azure
AWS Lambda | ~Lambda; aws lambda
Amazon S3 | s3; aws s3
Amazon EC2 | ec2; aws ec2
Amazon ECS | ecs; aws ecs
Amazon EKS | eks; aws eks
Amazon RDS | rds; aws rds
Amazon SQS | sqs; aws sqs
Google Kubernetes Engine | gke
Serverless | serverless computing
Docker |
Kubernetes | k8s
~Helm |
Terraform |
Ansible |
Pulumi |
Infrastructure as Code | iac; infrastructure-as-code
CI/CD | continuous integration; continuous delivery; continuous deployment; ci cd; ci/cd pipelines
GitHub Actions | gh actions
GitLab CI | gitlab ci/cd
Jenkins |
CircleCI | circle ci
Git |
GitHub |
Linux |
DevOps | dev ops
Site Reliability Engineering | sre
Observability |
Datadog |
Prometheus |
Grafana |
~Sentry |
Machine Learning | ~ML; machine-learning
Deep Learning | deep-learning
Artificial Intelligence | ~AI
Natural Language Processing | nlp
Computer Vision |
Large Language Models | llm; llms; large language model
Generative AI | genai; gen ai; generative artificial intelligence
Retrieval-Augmented Generation | ~RAG; retrieval augmented generation
Prompt Engineering |
MLOps | ml ops
PyTorch |
TensorFlow |
Keras |
scikit-learn | sklearn; scikit learn
pandas |
NumPy |
Hugging Face | huggingface
LangChain |
OpenAI API | openai
~Spark | apache spark; pyspark
Hadoop | apache hadoop
Apache Flink | flink
Databricks |
~Snowflake |
BigQuery | big query; google bigquery
Airflow | apache airflow
dbt | data build tool
ETL | extract, transform, load; extract transform load
Data Warehouse | data warehousing; dwh
Data Pipelines | data pipeline
Data Visualization | data viz; dataviz; data visualisation
Data Analysis | data analytics
Business Intelligence | ~BI
Statistics | statistical analysis
A/B Testing | a/b tests; a/b test; ab testing; split testing
Tableau |
Power BI | powerbi; microsoft power bi
~Looker |
~Excel | microsoft excel; ms excel
Visual Basic for Applications | vba
Microsoft Office | ms office; office 365; microsoft 365
Google Workspace | g suite; gsuite
~Amplitude |
Mixpanel |
Google Analytics | ga4; google analytics 4
Figma |
~Sketch |
Adobe Creative Suite | adobe creative cloud; creative cloud
Photoshop | adobe photoshop
Illustrator | adobe illustrator
User Experience | ux; ux design; user experience design
User Interface | ui; ui design; user interface design
User Research | ux research
Design Systems | design system
Prototyping | prototypes; prototype
Wireframing | wireframes; wireframe
Accessibility | a11y
WCAG | web content accessibility guidelines
Usability Testing | usability tests; usability studies
Agile | agile methodology; agile methodologies
Scrum | scrum master
Kanban |
Jira | atlassian jira
~Confluence |
Product Management |
Product Roadmap | roadmap; roadmaps; product roadmaps; roadmapping
Product Requirements Document | prd; prds; product requirements documents
Stakeholder Management |
Cross-Functional | cross functional; cross-functionally
OKRs | okr; objectives and key results
Key Performance Indicators | kpi; kpis
Go-to-Market | gtm; go to market
Product-Led Growth | plg; product led growth
B2B | business-to-business; business to business
B2C | business-to-consumer; business to consumer
SaaS | software as a service
Annual Recurring Revenue | arr
Monthly Recurring Revenue | mrr
Return on Investment | roi
Customer Acquisition Cost | cac
Customer Lifetime Value | ltv; clv; lifetime value
Net Promoter Score | nps
Customer Relationship Management | crm
Salesforce | sfdc; salesforce.com
HubSpot |
Account Executive | ~AE
Sales Development Representative | sdr; sdrs
Business Development Representative | bdr; bdrs
MEDDICC |
Pipeline Generation | pipeline building
Cold Calling | cold calls; cold call
Contract Negotiation | contract negotiations
Customer Success |
Search Engine Optimization | seo; search engine optimisation
Search Engine Marketing | sem
Pay-Per-Click | ppc; pay per click
Social Media Marketing |
Email Marketing |
Content Marketing |
Marketing Automation |
Demand Generation | demand gen
Brand Management | brand strategy
Financial Modeling | financial modelling; financial models; financial model
FP&A | financial planning and analysis; financial planning & analysis
GAAP | us gaap; generally accepted accounting principles
IFRS | international financial reporting standards
Discounted Cash Flow | dcf
P&L | profit and loss; profit & loss; pnl
Mergers and Acquisitions | m&a; mergers & acquisitions
Variance Analysis | variance reporting
Forecasting | forecasts; forecast
Budgeting |
SOX | sarbanes-oxley; sarbanes oxley
CPA | certified public accountant
CFA | chartered financial analyst
ERP | enterprise resource planning
~SAP |
NetSuite | oracle netsuite
QuickBooks | quick books
Project Management |
PMP | project management professional
Program Management |
Supply Chain Management | supply chain; scm
Human Resources | ~HR
Recruiting | talent acquisition
Applicant Tracking System | ats
MBA | master of business administration
PhD | ph.d.; doctor of philosophy
Registered Nurse | ~RN; registered nurses
Licensed Practical Nurse | lpn; licensed vocational nurse; lvn
Certified Nursing Assistant | ~CNA; nursing assistant
BSN | bachelor of science in nursing; b.s. in nursing
Nurse Practitioner | ~NP
Basic Life Support | ~BLS
Advanced Cardiovascular Life Support | ~ACLS; advanced cardiac life support
Pediatric Advanced Life Support | ~PALS
Electronic Health Records | ehr; ehrs; electronic health record; electronic medical records; emr; emrs
~Epic | epic systems; epic ehr
Cerner | oracle cerner
Pyxis |
Intensive Care Unit | ~ICU
Emergency Department | ~ED; ~ER; emergency room
Medical-Surgical | med-surg; med surg; medical surgical
Telemetry |
Operating Room | ~OR
Labor and Delivery | l&d; labor & delivery
Charge Nurse |
Patient Care |
Patient Education | patient teaching; discharge teaching; discharge education
Medication Administration | med pass; administering medications
IV Therapy | intravenous therapy; ~IV
Infection Control | infection prevention
Wound Care |
HIPAA | health insurance portability and accountability act
ICD-10 | icd10; icd 10
CPT | current procedural terminology
Medical Coding |
OSHA | occupational safety and health administration
Cybersecurity | cyber security; information security; infosec
Penetration Testing | pen testing; pentesting
SOC 2 | soc2; soc ii
ISO 27001 | iso/iec 27001
Identity and Access Management | iam
Single Sign-On | sso
OAuth | oauth2; oauth 2.0
TCP/IP | tcp ip
DNS | domain name system
VPN | virtual private network
Embedded Systems | embedded software
Firmware |
RTOS | real-time operating system
FPGA | field-programmable gate array
MATLAB |
AutoCAD |
SolidWorks |
GIS | geographic information systems; geographic information system
iOS |
Android |
SwiftUI |
Flutter |
~Unity |
Unreal Engine | ~Unreal
Objective-C | objc; objective c
`;

/**
 * Phrases where a table name means something else ("MQL to SQL" is a sales-qualified lead, not the query language).
 * Matching runs on the text with these replaced by a neutral word.
 */
export const FALSE_FRIENDS: readonly RegExp[] = [
  /\bMQLs?\s*(?:to|->|→|and|\/|-)\s*SQLs?\b/g,
  /\bSQLs?\s*(?:to|->|→)\s*(?:opportunit|close|won|pipeline|SAL)/gi,
];

/** The text with every false-friend phrase neutralised. */
export function scrubFalseFriends(text: string): string {
  let out = text;
  for (const re of FALSE_FRIENDS) out = out.replace(re, (m) => m.replace(/SQL/gi, "sales-qualified-lead"));
  return out;
}

export type AliasGroup = {
  /** Lower-cased key of the canonical name. */
  key: string;
  /** Canonical name as written in the table. */
  display: string;
  /** Every name, as written, the canonical first. */
  names: string[];
  /** Names that match case-sensitively (the table's `~` names), as written. */
  exact: string[];
};

const keyOf = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function parseAliasTable(raw: string): AliasGroup[] {
  const out: AliasGroup[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [head = "", rest = ""] = line.split("|");
    const names: string[] = [];
    const exact: string[] = [];
    for (const n of [head, ...rest.split(";")].map((x) => x.trim()).filter(Boolean)) {
      const cs = n.startsWith("~");
      const name = cs ? n.slice(1).trim() : n;
      names.push(name);
      if (cs) exact.push(name);
    }
    if (names.length === 0) continue;
    out.push({ key: keyOf(names[0]!), display: names[0]!, names, exact });
  }
  return out;
}

export const ALIAS_GROUPS: readonly AliasGroup[] = parseAliasTable(ALIAS_TABLE);

const byName = new Map<string, AliasGroup>();
for (const g of ALIAS_GROUPS) for (const n of g.names) if (!byName.has(keyOf(n))) byName.set(keyOf(n), g);

/** The group a name belongs to, or null for a name the table does not know. */
export function aliasGroupOf(name: string): AliasGroup | null {
  return byName.get(keyOf(name)) ?? null;
}

/** Canonical key for a name ("k8s" -> "kubernetes"); an unknown name is its own key. */
export function canonicalTerm(name: string): string {
  return aliasGroupOf(name)?.key ?? keyOf(name);
}

/** Letters of a long form's significant words ("Amazon Web Services" -> "aws", "Financial Planning and Analysis" -> "fpa"). */
function initialism(longForm: string): string {
  return longForm.split(/[\s-]+/).filter((w) => w && !/^(and|of|the|for|&|in|to)$/i.test(w)).map((w) => w[0]!.toLowerCase()).join("");
}

const lettersOf = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The acronym and long form of a term when the table has both ("AWS" and "Amazon Web Services"), else null. Spelling
 * variants (Postgres, K8s) are not acronyms and return null.
 */
export function acronymPair(name: string): { acronym: string; long: string } | null {
  const g = aliasGroupOf(name);
  if (!g) return null;
  const shorts = g.names.filter((n) => !/\s/.test(n) && lettersOf(n).length >= 2 && lettersOf(n).length <= 6);
  const longs = g.names.filter((n) => /\s/.test(n));
  // The table writes most acronyms in lower case ("ehr"); show them in capitals.
  const shown = (n: string) => (n === n.toLowerCase() ? n.toUpperCase() : n);
  for (const s of shorts) {
    const long = longs.find((l) => initialism(l) === lettersOf(s));
    if (long) return { acronym: shown(s), long };
  }
  return null;
}

/**
 * The canonical skill map, in one place: one name per skill, its synonyms, and the broader groups it belongs to.
 * graph (normalising and finding skills) and match (skill relations) both build on this table, so the skills the graph
 * writes into `career_points.skills` resolve to the same keys when matching.
 *
 * Each line is `Canonical | parent; parent | synonym; synonym`. A synonym starting with `~` is "list only": it matches
 * (case-sensitively) when the text is a skills list ("Python, Go, JS") and never inside prose, so short ambiguous tokens
 * like Go, C, R or JS do not fire on ordinary sentences.
 */
export const SKILL_TABLE = `
JavaScript | Programming Languages; Web Development | js; ecmascript; es6; es2015; es2020; vanilla js; ~JS
TypeScript | Programming Languages; Web Development | ~TS
Python | Programming Languages | python3; python 3
Java | Programming Languages | java se; java ee; j2ee; java 8; java 11; java 17
C++ | Programming Languages | cpp; c plus plus
C# | Programming Languages | csharp; c sharp
C | Programming Languages | ~C; ansi c
Go | Programming Languages | golang; go lang; ~Go
Rust | Programming Languages | rustlang
Ruby | Programming Languages |
PHP | Programming Languages |
Swift | Programming Languages; Mobile Development | swiftui
Kotlin | Programming Languages; Mobile Development |
Scala | Programming Languages |
R | Programming Languages; Data Analysis | ~R; r language; r programming
SQL | Programming Languages; Databases | t-sql; tsql; pl/sql; plsql; ansi sql
Bash | Programming Languages; DevOps | shell scripting; bash scripting; zsh
PowerShell | Programming Languages | power shell
HTML | Web Development | html5
CSS | Web Development | css3
React | Frontend Frameworks; Web Development | reactjs; react.js; react js
React Native | Mobile Development; Frontend Frameworks | react-native
Next.js | Frontend Frameworks; Web Development | nextjs; next js
Vue | Frontend Frameworks; Web Development | vue.js; vuejs; vue js; vue 3
Angular | Frontend Frameworks; Web Development | angularjs; angular.js
Svelte | Frontend Frameworks; Web Development | sveltekit
Redux | Frontend Frameworks | redux toolkit; rtk
Tailwind CSS | Web Development | tailwind; tailwindcss
GraphQL | API Design | apollo; apollo client; apollo server
Node.js | Backend Frameworks; Web Development | nodejs; node js
Express | Backend Frameworks; Web Development | express.js; expressjs
NestJS | Backend Frameworks | nest.js
Django | Backend Frameworks; Web Development | django rest framework; drf
Flask | Backend Frameworks; Web Development |
FastAPI | Backend Frameworks; Web Development | fast api
Spring Boot | Backend Frameworks; Web Development | spring framework; spring mvc; spring cloud
.NET | Backend Frameworks | dotnet; .net core; .net framework; asp.net; asp.net core
Ruby on Rails | Backend Frameworks; Web Development | rails; ror
REST APIs | API Design | restful; restful apis; rest api; restful api; restful services; rest services
gRPC | API Design | grpc; protobuf; protocol buffers
Microservices | Software Architecture | microservice; micro-services; service-oriented architecture; soa
Distributed Systems | Software Architecture | distributed computing; concurrency
System Design | Software Architecture | software architecture; scalable systems; high availability
Event-Driven Architecture | Software Architecture | event driven; event sourcing; cqrs
Kafka | Messaging | apache kafka; kafka streams
RabbitMQ | Messaging | amqp
Message Queues | Messaging | sqs; message queue; pub/sub; pubsub
WebSockets | Web Development | websocket; web sockets; socket.io
OAuth | Security | oauth2; oauth 2.0; oidc; openid connect; saml
PostgreSQL | Databases; Relational Databases | postgres; psql
MySQL | Databases; Relational Databases | mariadb
SQLite | Databases; Relational Databases |
SQL Server | Databases; Relational Databases | mssql; ms sql; microsoft sql server
Oracle Database | Databases; Relational Databases | oracle db; oracle sql
MongoDB | Databases; NoSQL | mongo; mongoose
DynamoDB | Databases; NoSQL | dynamo db
Cassandra | Databases; NoSQL | apache cassandra
Redis | Databases; Caching | memcached
Elasticsearch | Databases; Search | elastic search; opensearch; elk stack
Neo4j | Databases; Graph Databases | graph database; graph databases
pgvector | Databases; Vector Search | vector database; vector databases; vector search
Snowflake | Data Warehousing | snowflake data warehouse
BigQuery | Data Warehousing | big query
Redshift | Data Warehousing | amazon redshift
Databricks | Data Engineering | delta lake
Spark | Data Engineering | apache spark; pyspark; spark sql
Hadoop | Data Engineering | hdfs; mapreduce; hive
Airflow | Data Engineering | apache airflow; dagster; prefect
dbt | Data Engineering | data build tool
ETL | Data Engineering | elt; data pipelines; data pipeline; data ingestion
Data Modeling | Data Engineering | data models; dimensional modeling; schema design; database design
Tableau | Data Visualization; Business Intelligence |
Power BI | Data Visualization; Business Intelligence | powerbi; power-bi
Looker | Data Visualization; Business Intelligence | looker studio; lookml; metabase
Pandas | Data Analysis | dataframes
NumPy | Data Analysis | scipy
Excel | Data Analysis | microsoft excel; advanced excel; pivot tables; vlookup
Statistics | Data Analysis | statistical analysis; statistical modeling; hypothesis testing; regression analysis
A/B Testing | Data Analysis | ab testing; a/b tests; split testing; experimentation
Machine Learning | Artificial Intelligence | ~ML; ml models; predictive modeling; supervised learning; unsupervised learning
Deep Learning | Machine Learning | neural networks; neural network; cnn; rnn
NLP | Machine Learning | natural language processing; text mining
Computer Vision | Machine Learning | image recognition; object detection; opencv
PyTorch | Machine Learning; Deep Learning | torch
TensorFlow | Machine Learning; Deep Learning | tf.keras
scikit-learn | Machine Learning | sklearn; scikit learn
LLMs | Artificial Intelligence | llm; large language models; large language model; generative ai; genai; gen ai; gpt-4; gpt-3
RAG | LLMs | retrieval augmented generation; retrieval-augmented generation; semantic search
AI Agents | LLMs | ai agent; llm agents; agentic; agentic workflows; multi-agent; tool calling; function calling
Prompt Engineering | LLMs | prompt design; prompting; prompt optimization
Fine-tuning | LLMs | finetuning; fine tuning; lora; qlora; rlhf
MLOps | Machine Learning; DevOps | ml ops; model serving; model deployment; mlflow
AWS | Cloud Platforms | amazon web services; ec2; s3; ecs; eks; amazon ec2; cloudfront; rds
Azure | Cloud Platforms | microsoft azure; azure devops
Google Cloud | Cloud Platforms | gcp; google cloud platform; gke
Cloudflare | Cloud Platforms | cloudflare workers
Vercel | Cloud Platforms |
Kubernetes | Container Orchestration; DevOps | k8s; kube; kubectl; helm; aks
Docker | Containers; DevOps | dockerfile; docker compose; containerization; containers
Terraform | Infrastructure as Code; DevOps | hcl; opentofu
Pulumi | Infrastructure as Code; DevOps |
Ansible | Infrastructure as Code; DevOps |
CloudFormation | Infrastructure as Code; DevOps | aws cdk; cdk
CI/CD | DevOps | cicd; ci cd; continuous integration; continuous delivery; continuous deployment; github actions; gitlab ci; jenkins; circleci; travis ci; argo cd; argocd
Linux | DevOps; Operating Systems | unix; ubuntu; debian; centos; rhel
Nginx | DevOps | apache http server; haproxy
Prometheus | Observability; DevOps |
Grafana | Observability; DevOps |
Datadog | Observability; DevOps | new relic; splunk; observability
OpenTelemetry | Observability | otel; opentelemetry tracing
Site Reliability Engineering | DevOps | sre; incident response; on-call; slo; sli
Git | Software Engineering | github; gitlab; version control; bitbucket
Testing | Software Engineering | unit testing; integration testing; test automation; tdd; test-driven development; qa
Jest | Testing | vitest; mocha
Playwright | Testing; Browser Automation | puppeteer; selenium; cypress; end-to-end testing; e2e testing
Agile | Project Management | scrum; kanban; sprint planning; sprints
Project Management | Management | program management; jira; project planning; roadmap planning
Product Management | Management | product strategy; product roadmap; prd; product requirements
Leadership | Management | team leadership; people management; mentoring; mentorship; managing engineers
Stakeholder Management | Management | stakeholder communication; cross-functional collaboration
Technical Writing | Communication | api documentation
Figma | Design | sketch; adobe xd; ui design; ux design; ui/ux; user experience; prototyping; wireframing
Accessibility | Web Development | a11y; wcag; section 508
Security | Software Engineering | application security; appsec; owasp; penetration testing; encryption; cryptography
Android | Mobile Development | android sdk; jetpack compose
iOS | Mobile Development | ios development; uikit; xcode
Flutter | Mobile Development |
Salesforce | CRM | sfdc; apex
HubSpot | CRM |
SEO | Marketing | search engine optimization; sem
Financial Modeling | Finance | financial analysis; valuation; dcf
`;

export type SkillEntry = { name: string; parents: string[]; synonyms: string[]; listOnly: string[] };

export function parseSkillTable(raw: string): SkillEntry[] {
  const out: SkillEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [name = "", parents = "", synonyms = ""] = line.split("|").map((s) => s.trim());
    if (!name) continue;
    const syn = synonyms.split(";").map((s) => s.trim()).filter(Boolean);
    out.push({
      name,
      parents: parents.split(";").map((s) => s.trim()).filter(Boolean),
      synonyms: syn.filter((s) => !s.startsWith("~")),
      listOnly: syn.filter((s) => s.startsWith("~")).map((s) => s.slice(1)),
    });
  }
  return out;
}

export const SKILL_ENTRIES: readonly SkillEntry[] = parseSkillTable(SKILL_TABLE);

/**
 * Is-a links the category table lacks (lower-cased canonical key -> lower-cased parent keys): PostgreSQL is a kind of
 * SQL, React is built on JavaScript. They count as the nearest parent, ahead of the table's groups.
 */
export const SPECIFIC_PARENTS: Record<string, string[]> = {
  postgresql: ["sql"], mysql: ["sql"], sqlite: ["sql"], "sql server": ["sql"], "oracle database": ["sql"],
  typescript: ["javascript"], "node.js": ["javascript"], react: ["javascript"], vue: ["javascript"], angular: ["javascript"], svelte: ["javascript"],
  "next.js": ["react"], "react native": ["react"], express: ["node.js"], nestjs: ["node.js"],
  pandas: ["python"], numpy: ["python"], django: ["python"], flask: ["python"], fastapi: ["python"], pytorch: ["python"], tensorflow: ["python"], "scikit-learn": ["python"],
  "spring boot": ["java"], "ruby on rails": ["ruby"], kubernetes: ["docker"],
};

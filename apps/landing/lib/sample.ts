// Sample content for the page's demos. Every company here is made up, and every demo that shows it is tagged "Sample".

export type SampleJob = { title: string; company: string; meta: string; fit: string; note?: string };

export const TODAY: SampleJob[] = [
  { title: "Product analyst", company: "Fernway", meta: "Fernway · Remote", fit: "0.86" },
  { title: "Data analyst", company: "Halden Labs", meta: "Halden Labs · New York", fit: "0.81" },
  { title: "Operations analyst", company: "Mirro", meta: "Mirro · Austin", fit: "0.78", note: "1 question" },
];

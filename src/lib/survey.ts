import { z } from "zod";

// Demo survey. Real surveys would live in the database; one in code keeps the POC small.
export const survey = {
  id: "demo-2026",
  title: "Provider Workforce and Financial Survey",
  sections: [
    {
      title: "Average hourly wage paid, by staff type (USD)",
      fields: [
        { key: "wage_rn", label: "Registered nurses" },
        { key: "wage_lpn", label: "Licensed practical nurses" },
        { key: "wage_cna", label: "Certified nursing assistants" },
        { key: "wage_admin", label: "Administrative staff" },
      ],
    },
    {
      title: "Financials (USD)",
      fields: [
        { key: "net_revenue", label: "Net revenue, last fiscal year" },
        { key: "net_income", label: "Net income, last fiscal year" },
      ],
    },
  ],
} as const;

export type SurveyAnswers = Record<string, number | null>;

const keys: string[] = survey.sections.flatMap((s) => s.fields.map((f) => f.key));

const value = z.number().finite().min(0).max(1e12);

// Saving allows blanks (null or missing). Unknown keys are rejected, not silently dropped.
export const draftSchema = z.strictObject(
  Object.fromEntries(keys.map((k) => [k, value.nullable().optional()])),
);

// Submitting requires every field.
export const finalSchema = z.strictObject(Object.fromEntries(keys.map((k) => [k, value])));

export const orgNameSchema = z.string().trim().min(1).max(200);

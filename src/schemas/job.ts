import { z } from "zod";

export const JobTypeEnum = z.enum(["REPAIR", "PROJECT", "RETAINER"]);
export type JobType = z.infer<typeof JobTypeEnum>;

export const JobStatusEnum = z.enum([
  "RECEIVED",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "DELIVERED",
  "ACTIVE",
  "CANCELLED",
]);
export type JobStatus = z.infer<typeof JobStatusEnum>;

// Specific Metadata Schemas (Stored in jobs.metadata as JSON)
export const RepairMetadataSchema = z.object({
  deviceModel: z.string().trim().min(1, "Device model is required"),
  serialNumber: z.string().trim().optional().default(""),
  symptom: z.string().trim().min(1, "Symptom description is required"),
  accessories: z.string().trim().optional().default(""),
  partsCost: z.coerce.number().nonnegative().optional().default(0),
});
export type RepairMetadata = z.infer<typeof RepairMetadataSchema>;

export const ProjectMetadataSchema = z.object({
  domainUrl: z.string().trim().optional().default(""),
  scopeSummary: z.string().trim().min(1, "Scope summary is required"),
  repoUrl: z.string().trim().optional().default(""),
  deliverables: z.string().trim().optional().default(""),
});
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;

export const RetainerMetadataSchema = z.object({
  billingCycleDay: z.coerce.number().int().min(1).max(31),
  monthlyRate: z.coerce.number().nonnegative(),
  serviceScope: z.string().trim().min(1, "Service scope is required"),
});
export type RetainerMetadata = z.infer<typeof RetainerMetadataSchema>;

// Discriminated Union for Job Input & Validation
export const RepairJobInputSchema = z.object({
  job_type: z.literal("REPAIR"),
  client_id: z.coerce.number().int().positive("Client is required"),
  title: z.string().trim().min(1, "Title is required"),
  due_date: z.string().optional(),
  total_quoted_amount: z.coerce.number().nonnegative().default(0),
  metadata: RepairMetadataSchema,
});

export const ProjectJobInputSchema = z.object({
  job_type: z.literal("PROJECT"),
  client_id: z.coerce.number().int().positive("Client is required"),
  title: z.string().trim().min(1, "Title is required"),
  due_date: z.string().optional(),
  total_quoted_amount: z.coerce.number().nonnegative().default(0),
  metadata: ProjectMetadataSchema,
});

export const RetainerJobInputSchema = z.object({
  job_type: z.literal("RETAINER"),
  client_id: z.coerce.number().int().positive("Client is required"),
  title: z.string().trim().min(1, "Title is required"),
  due_date: z.string().optional(),
  total_quoted_amount: z.coerce.number().nonnegative().default(0),
  metadata: RetainerMetadataSchema,
});

export const JobInputSchema = z.discriminatedUnion("job_type", [
  RepairJobInputSchema,
  ProjectJobInputSchema,
  RetainerJobInputSchema,
]);

export type JobInput = z.infer<typeof JobInputSchema>;

// Helper function to safely parse job metadata from JSON string
export function parseJobMetadata(jobType: JobType, rawJson: string | null | undefined) {
  if (!rawJson) return null;
  try {
    const data = JSON.parse(rawJson);
    switch (jobType) {
      case "REPAIR":
        return RepairMetadataSchema.parse(data);
      case "PROJECT":
        return ProjectMetadataSchema.parse(data);
      case "RETAINER":
        return RetainerMetadataSchema.parse(data);
    }
  } catch (error) {
    console.error(`Failed to parse metadata for ${jobType}:`, error);
    return null;
  }
}

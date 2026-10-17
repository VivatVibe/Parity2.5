import { z } from "zod";

export const PaymentTypeEnum = z.enum(["DEPOSIT", "MILESTONE", "FINAL", "RETAINER_CYCLE"]);
export type PaymentType = z.infer<typeof PaymentTypeEnum>;

export const PaymentInputSchema = z
  .object({
    amount: z.coerce.number().positive("ยอดชำระต้องมากกว่า 0"),
    parts_cost: z.coerce.number().nonnegative("ต้นทุนอะไหล่ต้องไม่ติดลบ").default(0),
    payment_type: PaymentTypeEnum,
    billing_period: z
      .string()
      .regex(/^\d{4}-\d{2}$/, "รอบบิลต้องอยู่ในรูปแบบ YYYY-MM เช่น 2026-10")
      .optional(),
    note: z.string().trim().optional().default(""),
  })
  .refine(
    (data) => {
      if (data.payment_type === "RETAINER_CYCLE" && !data.billing_period) {
        return false;
      }
      return true;
    },
    {
      message: "การชำระรอบบิลรายเดือน (RETAINER_CYCLE) ต้องระบุรอบบิล (YYYY-MM)",
      path: ["billing_period"],
    }
  );

export type PaymentInput = z.infer<typeof PaymentInputSchema>;

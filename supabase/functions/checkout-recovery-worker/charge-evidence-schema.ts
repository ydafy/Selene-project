import { z } from "../_shared/zod-runtime.ts";

export const RecoveryChargeEvidenceSchema = z.string().min(1);

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import {
  listResolvedAnalysisSettings,
  type ResolvedAnalysisSettingsRecord,
  resolvedAnalysisSettingsRecordSchema,
} from "../features/config-resources.js";

type ListResolvedAnalysisSettings = (
  pool: Pool,
) => Promise<ResolvedAnalysisSettingsRecord[]>;

export const registerRuntimeConfigRoutes = (
  app: FastifyInstance,
  pool: Pool,
  listResolvedAnalysisSettingsFn: ListResolvedAnalysisSettings =
    listResolvedAnalysisSettings,
): void => {
  app.get("/v1/runtime-config/analysis-settings", {
    schema: {
      tags: ["runtime-config"],
      summary: "List active resolved analysis settings for runtime consumers",
      response: {
        200: {
          type: "array",
          items: resolvedAnalysisSettingsRecordSchema,
        },
      },
    },
    handler: async () => listResolvedAnalysisSettingsFn(pool),
  });
};

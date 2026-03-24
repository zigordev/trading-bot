import type { FastifyInstance, FastifyReply } from "fastify";

import {
  analysisSettingsBodySchema,
  analysisSettingsRecordSchema,
  type ConfigStore,
  type ConfigStores,
  symbolBodySchema,
  symbolRecordSchema,
  riskProfileBodySchema,
  riskProfileRecordSchema,
  strategyBodySchema,
  strategyRecordSchema,
  tradingDefaultsBodySchema,
  tradingDefaultsRecordSchema,
  timeframeBodySchema,
  timeframeRecordSchema,
} from "../features/config-resources.js";
import { HttpError } from "../http-error.js";

const idParamsSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
  },
  required: ["id"],
} as const;

const errorSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    message: { type: "string" },
  },
  required: ["statusCode", "message"],
} as const;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505";

const isForeignKeyViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23503";

const assertFound = <T>(entity: T | null, entityName: string, id: string): T => {
  if (!entity) {
    throw new HttpError(404, `${entityName} ${id} was not found`);
  }

  return entity;
};

const sendNoContent = (reply: FastifyReply): FastifyReply => reply.code(204).send();

type CrudRouteOptions<TInput, TRecord> = {
  path: string;
  tag: string;
  entityName: string;
  bodySchema: object;
  recordSchema: object;
  store: ConfigStore<TInput, TRecord>;
};

const registerCrudRoutes = <TInput, TRecord>(
  app: FastifyInstance,
  options: CrudRouteOptions<TInput, TRecord>,
): void => {
  const { bodySchema, entityName, path, recordSchema, store, tag } = options;

  app.get(path, {
    schema: {
      tags: [tag],
      summary: `List ${tag}`,
      response: {
        200: {
          type: "array",
          items: recordSchema,
        },
      },
    },
    handler: async () => store.list(),
  });

  app.get(`${path}/:id`, {
    schema: {
      tags: [tag],
      summary: `Get ${entityName} by id`,
      params: idParamsSchema,
      response: {
        200: recordSchema,
        404: errorSchema,
      },
    },
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const entity = await store.getById(id);
      return assertFound(entity, entityName, id);
    },
  });

  app.post(path, {
    schema: {
      tags: [tag],
      summary: `Create ${entityName}`,
      body: bodySchema,
      response: {
        201: recordSchema,
        409: errorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const created = await store.create(request.body as TInput);
        reply.code(201);
        return created;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            `${entityName} with ${store.uniqueFieldName} "${store.getUniqueFieldValue(
              request.body as TInput,
            )}" already exists`,
          );
        }

        if (isForeignKeyViolation(error)) {
          throw new HttpError(
            409,
            `${entityName} references configuration entries that do not exist`,
          );
        }

        throw error;
      }
    },
  });

  app.put(`${path}/:id`, {
    schema: {
      tags: [tag],
      summary: `Update ${entityName}`,
      params: idParamsSchema,
      body: bodySchema,
      response: {
        200: recordSchema,
        404: errorSchema,
        409: errorSchema,
      },
    },
    handler: async (request) => {
      const { id } = request.params as { id: string };

      try {
        const updated = await store.update(id, request.body as TInput);
        return assertFound(updated, entityName, id);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            `${entityName} with ${store.uniqueFieldName} "${store.getUniqueFieldValue(
              request.body as TInput,
            )}" already exists`,
          );
        }

        if (isForeignKeyViolation(error)) {
          throw new HttpError(
            409,
            `${entityName} references configuration entries that do not exist`,
          );
        }

        throw error;
      }
    },
  });

  app.delete(`${path}/:id`, {
    schema: {
      tags: [tag],
      summary: `Delete ${entityName}`,
      params: idParamsSchema,
      response: {
        204: {
          type: "null",
        },
        404: errorSchema,
        409: errorSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const deleted = await store.delete(id);

        if (!deleted) {
          throw new HttpError(404, `${entityName} ${id} was not found`);
        }
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new HttpError(
            409,
            `${entityName} ${id} is still referenced by another configuration resource`,
          );
        }

        throw error;
      }

      return sendNoContent(reply);
    },
  });
};

export const registerConfigurationRoutes = (
  app: FastifyInstance,
  stores: ConfigStores,
): void => {
  registerCrudRoutes(app, {
    path: "/v1/symbols",
    tag: "symbols",
    entityName: "symbol",
    bodySchema: symbolBodySchema,
    recordSchema: symbolRecordSchema,
    store: stores.symbols,
  });

  registerCrudRoutes(app, {
    path: "/v1/timeframes",
    tag: "timeframes",
    entityName: "timeframe",
    bodySchema: timeframeBodySchema,
    recordSchema: timeframeRecordSchema,
    store: stores.timeframes,
  });

  registerCrudRoutes(app, {
    path: "/v1/strategies",
    tag: "strategies",
    entityName: "strategy",
    bodySchema: strategyBodySchema,
    recordSchema: strategyRecordSchema,
    store: stores.strategies,
  });

  registerCrudRoutes(app, {
    path: "/v1/risk-profiles",
    tag: "risk-profiles",
    entityName: "risk profile",
    bodySchema: riskProfileBodySchema,
    recordSchema: riskProfileRecordSchema,
    store: stores.riskProfiles,
  });

  registerCrudRoutes(app, {
    path: "/v1/trading-defaults",
    tag: "trading-defaults",
    entityName: "trading defaults profile",
    bodySchema: tradingDefaultsBodySchema,
    recordSchema: tradingDefaultsRecordSchema,
    store: stores.tradingDefaults,
  });

  registerCrudRoutes(app, {
    path: "/v1/analysis-settings",
    tag: "analysis-settings",
    entityName: "analysis setting",
    bodySchema: analysisSettingsBodySchema,
    recordSchema: analysisSettingsRecordSchema,
    store: stores.analysisSettings,
  });
};

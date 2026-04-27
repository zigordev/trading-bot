import { Pool } from "pg";

import type { AppConfig } from "../config.js";

export const createPool = (config: AppConfig): Pool =>
  new Pool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    max: 5,
  });

export const checkDatabaseReadiness = async (pool: Pool): Promise<void> => {
  await pool.query("SELECT 1");
};

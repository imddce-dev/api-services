import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as schema from './schema';

const poolConnection = mysql.createPool({
  host: process.env.DB_HOST,
  // user: process.env.DB_USERNAME,
  user: process.env.DB_USERNAME_EBS || process.env.DB_USER,
  password: process.env.DB_PASSWORD_EBS,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});


export const db = drizzle(poolConnection, { schema, mode: 'default' });

// --- MEBS ---
const poolMEBS = mysql.createPool({
  host: process.env.DB_HOST_MEBS,
  user: process.env.DB_USERNAME_MEBS || process.env.DB_USER,
  password: process.env.DB_PASSWORD_MEBS,
  database: process.env.DB_DATABASE_MEBS,
  port: Number(process.env.DB_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export const dbMEBS = drizzle(poolMEBS, { schema, mode: 'default' });

const poolAPI = mysql.createPool({
  host: process.env.DB_HOST_API,
  user: process.env.DB_USERNAME_API || process.env.DB_USER,
  password: process.env.DB_PASSWORD_API,
  database: process.env.DB_DATABASE_API,
  port: Number(process.env.DB_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
export const dbAPI = drizzle(poolAPI, { schema, mode: 'default' });
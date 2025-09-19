import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as schema from './schema';

const poolConnection = mysql.createPool({
  host: process.env.DB_HOST,
  // user: process.env.DB_USERNAME,
  user: process.env.DB_USERNAME || process.env.DB_USER,
  password: process.env.DB_PASSWORD,
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
  user: process.env.DB_USERNAME || process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE_MEBS,
  port: Number(process.env.DB_PORT || 3306),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export const dbMEBS = drizzle(poolMEBS, { schema, mode: 'default' });
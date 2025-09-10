
import { MySql2Database, drizzle } from 'drizzle-orm/mysql2';
import { users } from '../Config/mysql/schema';
import { eq } from 'drizzle-orm';

export type DrizzleDB = MySql2Database<typeof import('../Config/mysql/schema')>;


export const findAll = async (db: DrizzleDB) => {
  return await db.query.users.findMany();
};

export const create = async (db: DrizzleDB, data: { name: string; email: string }) => {
  const result = await db.insert(users).values(data);
  const newId = result[0].insertId;
  return { id: newId, ...data };
};
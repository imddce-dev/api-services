import { Context } from 'hono';
import * as userModel from '../Models/user.model';
import { DrizzleDB } from '../Models/user.model'; 
export const getAllUsers = async (c: Context) => {
  try {
    const db = c.get('db') as DrizzleDB;
    const users = await userModel.findAll(db);
    return c.json(users);
  } catch (error) {
    console.error(error);
    return c.json({ message: 'Cannot fetch users' }, 500);
  }
};
export const createUser = async (c: Context) => {
    try {
        const db = c.get('db') as DrizzleDB;
        const body = await c.req.json();
        const newUser = await userModel.create(db, body);
        return c.json(newUser, 201);
    } catch (error) {
        console.error(error);
        return c.json({ message: 'Cannot create user' }, 400);
    }
};
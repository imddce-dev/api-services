import { Hono } from 'hono';
import * as userController from './Controllers/user.controller';
import { db } from './Config/mysql';
import { DrizzleDB } from './Models/user.model';
import { sql } from 'drizzle-orm'; 
type AppContext = {
  Variables: {
    db: DrizzleDB
  }
}

const app = new Hono<AppContext>();
app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});

const api = app.basePath('/api');
api.get('/users', userController.getAllUsers);
api.post('/users', userController.createUser);
app.get('/', (c) => c.text('API is running!'));


const startup = async () => {
  try {
    await db.execute(sql`select 1`);
    console.log('✅ Database connection successfully.');
  } catch (error) {
    console.error('❌ Could not connect to the database:', error);
    process.exit(1);
  }
};

startup();

export default app;
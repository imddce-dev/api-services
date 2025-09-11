import { Hono } from 'hono';
import * as userController from './Controllers/user.controller';
import { db } from './Config/mysql';
import { DrizzleDB } from './Models/user.model';
import { sql } from 'drizzle-orm'; 
import { ebsRouter } from './Controllers/ebsController';
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
// ✅ /api/v1/<source>
api.route('/v1', ebsRouter);

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

// 👇 สำคัญ: ให้ Bun เสิร์ฟ Hono ที่พอร์ตนี้
const port = Number(process.env.SERVER_PORT || process.env.PORT || 8080);
export default {
  port,
  fetch: app.fetch,
};
// export default app;
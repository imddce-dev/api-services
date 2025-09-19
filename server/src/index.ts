import { serve } from 'bun';
import { Hono } from 'hono';
import { ebsRouter } from './Controllers/ebs.controller';
import { mebsRouter } from './Controllers/mebs.controller';
import { db, dbMEBS } from './Config/mysql';
import { DrizzleDB } from './Models/user.model';
import { sql } from 'drizzle-orm';
import * as userController from './Controllers/user.controller';
import { uploadRouter } from './Controllers/upload.controller';

type AppContext = {
  Variables: {
    db: DrizzleDB
  }
};

const app = new Hono<AppContext>();

// set db
app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});

const api = app.basePath('/api');
api.get('/users', userController.getAllUsers);
api.post('/users', userController.createUser);
app.get('/', (c) => c.text('API is running!'));
api.route('/v1', ebsRouter);
api.route('/v2/mebs', mebsRouter);
app.route('/', uploadRouter);

// เช็ค DB
(async () => {
  try {
    await db.execute(sql`select 1`);
    console.log('✅ EBS DB ok');
    await dbMEBS.execute(sql`select 1`);
    console.log('✅ MEBS DB ok');
  } catch (err) {
    console.error('❌ DB check failed:', err);
    process.exit(1);
  }
})();

// พอร์ตและ hostname
const port = Number(process.env.PORT || 8080);
console.log(`🚀 Server running on 0.0.0.0:${port}`);

serve({
  port,
  hostname: '0.0.0.0',   // ฟังทุก interface
  fetch: app.fetch,
});

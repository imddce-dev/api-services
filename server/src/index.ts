import { serve } from 'bun';
import { Hono } from 'hono';
import { ebsRouter } from './Controllers/ebs.controller';
import { mebsRouter } from './Controllers/mebs.controller';
import { db, dbMEBS, dbAPI } from './Config/mysql';
import { DrizzleDB } from './Models/user.model';
import { sql } from 'drizzle-orm';
import * as userController from './Controllers/user.controller';
import { uploadRouter } from './Controllers/upload.controller';
import { apiKeyAuth } from './Middleware/apikey';
import { downloadRouter } from './Controllers/download.controller';

type AppContext = {
  Variables: {
    db: DrizzleDB
  }
};

const app = new Hono<AppContext>();

app.get('/healthz', (c) => c.text('ok'));
// ✅ ใส่ middleware ตรงนี้ (ครอบทุก /api/*)
app.use('/api/*', apiKeyAuth({
  clientHeader: 'x-client-key',
  secretHeader: 'x-secret-key',
  allowQueryParam: true,    // ✅ แนะนำปิด ไม่ให้ส่ง key ผ่าน query string
  // publicPaths: [/^\/api\/public/], // ถ้ามี API ที่ไม่ต้องตรวจ key
}));

const api = app.basePath('/api');
api.get('/users', userController.getAllUsers);
api.post('/users', userController.createUser);
app.get('/', (c) => c.text('API is running!'));
api.route('/v1', ebsRouter);
api.route('/v2/mebs', mebsRouter);
app.route('/', uploadRouter);
app.route('/', downloadRouter);

// เช็ค DB
(async () => {
  try {
    await db.execute(sql`select 1`);
    console.log('✅ EBS DB ok');
    await dbMEBS.execute(sql`select 1`);
    console.log('✅ MEBS DB ok');
    await dbAPI.execute(sql`select 1`);
    console.log('✅ API Service DB ok');
  } catch (err) {
    console.error('❌ DB check failed:', err);
    process.exit(1);
  }
})();
// function firstRow(res: any) {
//   if (res && Array.isArray(res.rows)) return res.rows[0] ?? {};
//   if (Array.isArray(res)) return res[0]?.[0] ?? {};
//   return {};
// }
// function mapFields(res: any, field = 'Field') {
//   if (res && Array.isArray(res.rows)) return res.rows.map((r: any) => r[field]);
//   if (Array.isArray(res)) return (res[0] ?? []).map((r: any) => r[field]);
//   return [];
// }

// (async () => {
//   const dbRes: any = await dbAPI.execute(sql`SELECT DATABASE() AS db`);
//   const dbName = firstRow(dbRes).db;
//   console.log('🔎 dbAPI DATABASE() =', dbName);

//   const DB = process.env.DB_DATABASE_API || 'api_service_dev';
//   const colsRes: any = await dbAPI.execute(
//     sql`SHOW COLUMNS FROM ${sql.raw('`' + DB + '`.`api_keys`')}`
//   );
//   const columns = mapFields(colsRes, 'Field');
//   console.log('🔎 api_keys columns =', columns);
// })();

// พอร์ตและ hostname
const port = Number(process.env.PORT || 8080);
console.log(`🚀 Server running on 0.0.0.0:${port}`);

serve({
  port,
  hostname: '0.0.0.0',   // ฟังทุก interface
  fetch: app.fetch,
});

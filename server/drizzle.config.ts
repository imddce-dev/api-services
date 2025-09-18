import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'mysql',
    schema: './src/Config/mysql/schema.ts',
    out: './drizzle/migrations',
    dbCredentials: {
        host: process.env.DB_HOST!,
        user: process.env.DB_USERNAME!,
        password: process.env.DB_PASSWORD!,
        database: process.env.DB_DATABASE!,
  },
})
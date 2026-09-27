import { createApp } from './app.mjs';
const app = await createApp();
await app.listen({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '127.0.0.1' });
console.log('Compasso API listening on port', process.env.PORT || 8787);
console.log('AI service:', process.env.OPENAI_API_KEY ? 'configured' : 'not configured');

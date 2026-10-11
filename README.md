# KingCRM

独立的 TypeScript / Node.js CRM。Java 版在同级目录。产品介绍和界面截图见 [项目介绍.md](./项目介绍.md)，协议和数据库说明见 [PLAN.md](./PLAN.md)。

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

默认接口地址：`http://127.0.0.1:8083`。

前端在 `frontend/`，开发时代理到上面的接口：

```bash
cd frontend
pnpm install
cd packages/web
pnpm exec vite --config ./config/vite.config.dev.ts --host 127.0.0.1 --port 5173
```

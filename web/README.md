# AgentShell dashboard

```sh
npm install
npm run dev
```

Vite proxies `/api` to the AgentShell Runtime at `127.0.0.1:4242`. Set
`VITE_DEMO_MODE=true` to use the isolated in-browser demo adapter. Production
assets are generated with `npm run build` and exposed to Go through `Dist()` in
`embed.go`.

Validation:

```sh
npm test
npm run test:e2e
npm run build
```

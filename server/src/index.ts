import { createAIProvider } from "./ai";
import { createApiServer } from "./app";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);
const aiProvider = createAIProvider();
const server = createApiServer(aiProvider);

server.listen(port, host, () => {
  console.log(
    `[server] Listening on http://${host}:${port} with ${aiProvider.name} AI provider`,
  );
});

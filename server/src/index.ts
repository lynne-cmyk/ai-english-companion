import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  response.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(port, host, () => {
  console.log(`[server] Listening on http://${host}:${port}`);
});

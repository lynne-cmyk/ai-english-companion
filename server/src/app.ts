import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AIProvider, GenerateExplanationInput } from "./ai";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;

    if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body);
}

function validateExplanationInput(value: unknown): GenerateExplanationInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;

  if (
    typeof input.word !== "string" ||
    input.word.trim() === "" ||
    typeof input.source_app !== "string" ||
    typeof input.user_goal !== "string"
  ) {
    return null;
  }

  return {
    word: input.word.trim(),
    source_app: input.source_app,
    user_goal: input.user_goal,
  };
}

export function createApiServer(aiProvider: AIProvider) {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && request.url === "/ai/explain") {
      let requestBody: unknown;

      try {
        requestBody = await readJsonBody(request);
      } catch {
        sendJson(response, 400, { error: "Invalid JSON body" });
        return;
      }

      const input = validateExplanationInput(requestBody);

      if (input === null) {
        sendJson(response, 400, {
          error: "word, source_app, and user_goal are required",
        });
        return;
      }

      try {
        const result = await aiProvider.generateExplanation(input);
        sendJson(response, 200, result);
      } catch {
        sendJson(response, 500, { error: "AI provider failed" });
      }

      return;
    }

    sendJson(response, 404, { error: "Not Found" });
  });
}

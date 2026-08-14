import type { AIProvider } from "./provider";
import { DeepSeekAIProvider } from "./deepSeekProvider";
import { MockAIProvider } from "./mockProvider";

export function createAIProvider(
  environment: NodeJS.ProcessEnv = process.env,
): AIProvider {
  const providerName = (environment.AI_PROVIDER ?? "mock").trim().toLowerCase();

  if (providerName === "mock") {
    return new MockAIProvider();
  }

  if (providerName === "deepseek") {
    return new DeepSeekAIProvider({ environment });
  }

  throw new Error(
    `Unsupported AI_PROVIDER: ${environment.AI_PROVIDER}. Use mock or deepseek.`,
  );
}

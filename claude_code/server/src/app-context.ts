import type { ServerConfig } from "./config.js";
import { AuthManager } from "./auth.js";
import { AcpAgent } from "./acp-agent.js";
import { SessionManager } from "./session-manager.js";

/** Wires the long-lived singletons together. */
export interface AppContext {
  config: ServerConfig;
  auth: AuthManager;
  agent: AcpAgent;
  sessions: SessionManager;
}

export function createAppContext(config: ServerConfig): AppContext {
  const auth = new AuthManager(config);
  const agent = new AcpAgent(config, () => auth.getApiKey());
  const sessions = new SessionManager(agent);
  return { config, auth, agent, sessions };
}

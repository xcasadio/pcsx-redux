/**
 * MCP Tools: PSX controller input simulation.
 *
 * PSX buttons use active-low logic: a bit set to 0 in the override mask forces
 * a button pressed regardless of physical controller state.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PcsxClient } from "../pcsx-client.js";
export declare function registerInputTools(server: McpServer, client: PcsxClient): void;
//# sourceMappingURL=input.d.ts.map
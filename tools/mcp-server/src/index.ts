/**
 * PCSX-Redux MCP Server
 *
 * Model Context Protocol server that connects to the PCSX-Redux PSX emulator,
 * exposing its debugging and analysis capabilities as AI tools.
 *
 * Usage:
 *   PCSX_HOST=localhost PCSX_PORT=8080 node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PcsxClient } from "./pcsx-client.js";
import { registerExecutionTools } from "./tools/execution.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerDisassemblyTools } from "./tools/disassembly.js";
import { registerDebugTools } from "./tools/debug.js";
import { registerCdromTools } from "./tools/cdrom.js";
import { registerSavestateTools } from "./tools/savestate.js";
import { registerInputTools } from "./tools/input.js";
import { registerSpuTools } from "./tools/spu.js";

const host = process.env.PCSX_HOST || "localhost";
const port = parseInt(process.env.PCSX_PORT || "8080", 10);
const timeout = parseInt(process.env.PCSX_TIMEOUT || "10000", 10);

const client = new PcsxClient(host, port, timeout);

const server = new McpServer({
  name: "pcsx-redux",
  version: "1.0.0",
});

// Register all tool groups
registerExecutionTools(server, client);
registerMemoryTools(server, client);
registerDisassemblyTools(server, client);
registerDebugTools(server, client);
registerCdromTools(server, client);
registerSavestateTools(server, client);
registerInputTools(server, client);
registerSpuTools(server, client);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `PCSX-Redux MCP Server started (connecting to ${host}:${port})`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

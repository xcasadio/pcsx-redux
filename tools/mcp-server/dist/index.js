"use strict";
/**
 * PCSX-Redux MCP Server
 *
 * Model Context Protocol server that connects to the PCSX-Redux PSX emulator,
 * exposing its debugging and analysis capabilities as AI tools.
 *
 * Usage:
 *   PCSX_HOST=localhost PCSX_PORT=8080 node dist/index.js
 */
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const pcsx_client_js_1 = require("./pcsx-client.js");
const execution_js_1 = require("./tools/execution.js");
const memory_js_1 = require("./tools/memory.js");
const disassembly_js_1 = require("./tools/disassembly.js");
const debug_js_1 = require("./tools/debug.js");
const cdrom_js_1 = require("./tools/cdrom.js");
const savestate_js_1 = require("./tools/savestate.js");
const input_js_1 = require("./tools/input.js");
const spu_js_1 = require("./tools/spu.js");
const host = process.env.PCSX_HOST || "localhost";
const port = parseInt(process.env.PCSX_PORT || "8080", 10);
const timeout = parseInt(process.env.PCSX_TIMEOUT || "10000", 10);
const client = new pcsx_client_js_1.PcsxClient(host, port, timeout);
const server = new mcp_js_1.McpServer({
    name: "pcsx-redux",
    version: "1.0.0",
});
// Register all tool groups
(0, execution_js_1.registerExecutionTools)(server, client);
(0, memory_js_1.registerMemoryTools)(server, client);
(0, disassembly_js_1.registerDisassemblyTools)(server, client);
(0, debug_js_1.registerDebugTools)(server, client);
(0, cdrom_js_1.registerCdromTools)(server, client);
(0, savestate_js_1.registerSavestateTools)(server, client);
(0, input_js_1.registerInputTools)(server, client);
(0, spu_js_1.registerSpuTools)(server, client);
// Start the server with stdio transport
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error(`PCSX-Redux MCP Server started (connecting to ${host}:${port})`);
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
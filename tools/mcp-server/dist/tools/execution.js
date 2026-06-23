"use strict";
/**
 * MCP Tools: Execution control (pause, resume, reset, status).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExecutionTools = registerExecutionTools;
const zod_1 = require("zod");
function registerExecutionTools(server, client) {
    server.tool("pcsx_get_status", "Get the current state of the PCSX-Redux emulator (running/paused, dynarec, RAM size, debugger enabled)", {}, async () => {
        try {
            const status = await client.getStatus();
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(status, null, 2),
                    },
                ],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_pause", "Pause the PSX emulator execution", {}, async () => {
        try {
            await client.pause();
            return {
                content: [{ type: "text", text: "Emulator paused." }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_resume", "Resume the PSX emulator execution", {}, async () => {
        try {
            await client.resume();
            return {
                content: [{ type: "text", text: "Emulator resumed." }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_reset", "Reset the PSX emulator (hard or soft reset)", {
        type: zod_1.z
            .enum(["hard", "soft"])
            .default("soft")
            .describe("Type of reset: 'hard' or 'soft'"),
    }, async ({ type }) => {
        try {
            await client.reset(type);
            return {
                content: [
                    { type: "text", text: `Emulator ${type} reset done.` },
                ],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_flush_cache", "Flush the PSX CPU instruction cache", {}, async () => {
        try {
            await client.flushCache();
            return {
                content: [{ type: "text", text: "CPU cache flushed." }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=execution.js.map
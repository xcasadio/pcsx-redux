"use strict";
/**
 * MCP Tools: Breakpoint management and debug control.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDebugTools = registerDebugTools;
const zod_1 = require("zod");
function parseAddress(addr) {
    if (addr.startsWith("0x") || addr.startsWith("0X")) {
        return parseInt(addr, 16);
    }
    return parseInt(addr, 10);
}
function registerDebugTools(server, client) {
    server.tool("pcsx_list_breakpoints", "List all currently set breakpoints with their addresses, types, labels, and enabled status.", {}, async () => {
        try {
            const result = await client.listBreakpoints();
            if (result.breakpoints.length === 0) {
                return {
                    content: [
                        { type: "text", text: "No breakpoints set." },
                    ],
                };
            }
            const lines = result.breakpoints.map((bp) => `${bp.enabled ? "[ON] " : "[OFF]"} ${bp.addressHex} ${bp.type.padEnd(5)} w=${bp.width} ${bp.label ? `"${bp.label}"` : ""} (${bp.source})`);
            return {
                content: [
                    {
                        type: "text",
                        text: `${result.breakpoints.length} breakpoint(s):\n${lines.join("\n")}`,
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
    server.tool("pcsx_add_breakpoint", "Add a breakpoint at a PSX address. When hit, the emulator pauses. Types: 'exec' (code execution), 'read' (memory read), 'write' (memory write).", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000') or decimal"),
        type: zod_1.z
            .enum(["exec", "read", "write"])
            .default("exec")
            .describe("Breakpoint type"),
        width: zod_1.z
            .number()
            .min(1)
            .max(4096)
            .default(4)
            .describe("Width in bytes (default 4 for exec)"),
        label: zod_1.z
            .string()
            .optional()
            .describe("Optional label/name for the breakpoint"),
    }, async ({ address, type, width, label }) => {
        try {
            const addr = parseAddress(address);
            await client.addBreakpoint(addr, type, width, label || "");
            return {
                content: [
                    {
                        type: "text",
                        text: `Breakpoint added: ${type} at 0x${addr.toString(16).padStart(8, "0")} (width=${width})${label ? ` "${label}"` : ""}`,
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
    server.tool("pcsx_remove_breakpoint", "Remove a breakpoint at a given address and type.", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000')"),
        type: zod_1.z
            .enum(["exec", "read", "write"])
            .default("exec")
            .describe("Breakpoint type to remove"),
    }, async ({ address, type }) => {
        try {
            const addr = parseAddress(address);
            await client.removeBreakpoint(addr, type);
            return {
                content: [
                    {
                        type: "text",
                        text: `Breakpoint removed: ${type} at 0x${addr.toString(16).padStart(8, "0")}`,
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
    server.tool("pcsx_toggle_breakpoint", "Enable or disable a breakpoint at a given address without removing it.", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000')"),
        enabled: zod_1.z
            .boolean()
            .describe("true to enable, false to disable"),
    }, async ({ address, enabled }) => {
        try {
            const addr = parseAddress(address);
            if (enabled) {
                await client.enableBreakpoint(addr);
            }
            else {
                await client.disableBreakpoint(addr);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Breakpoint at 0x${addr.toString(16).padStart(8, "0")} ${enabled ? "enabled" : "disabled"}.`,
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
    server.tool("pcsx_remove_all_breakpoints", "Remove all breakpoints at once.", {}, async () => {
        try {
            await client.removeAllBreakpoints();
            return {
                content: [
                    { type: "text", text: "All breakpoints removed." },
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
    server.tool("pcsx_wait_for_break", "Wait for the emulator to pause (e.g. after a breakpoint hit). Polls the emulator status until it stops running or timeout is reached. Returns the CPU registers when paused.", {
        timeout_ms: zod_1.z
            .number()
            .min(100)
            .max(60000)
            .default(10000)
            .describe("Maximum time to wait in milliseconds (default 10000)"),
        poll_interval_ms: zod_1.z
            .number()
            .min(50)
            .max(5000)
            .default(200)
            .describe("Polling interval in milliseconds (default 200)"),
    }, async ({ timeout_ms, poll_interval_ms }) => {
        try {
            const start = Date.now();
            while (Date.now() - start < timeout_ms) {
                const status = await client.getStatus();
                if (!status.running) {
                    const regs = await client.getRegisters();
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Emulator paused at PC=0x${(regs.pc >>> 0).toString(16).padStart(8, "0")} (cycle ${regs.cycle})`,
                            },
                        ],
                    };
                }
                await new Promise((r) => setTimeout(r, poll_interval_ms));
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Timeout after ${timeout_ms}ms — emulator still running.`,
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
}
//# sourceMappingURL=debug.js.map
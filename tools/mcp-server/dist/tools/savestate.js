"use strict";
/**
 * MCP Tools: Save states, VRAM dump, and screenshots.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSavestateTools = registerSavestateTools;
const zod_1 = require("zod");
function registerSavestateTools(server, client) {
    server.tool("pcsx_savestate_list", "List available save state slots (0-9) and named save states. Shows which slots are occupied.", {}, async () => {
        try {
            const usage = await client.getSaveStateUsage();
            const lines = ["Save state slots:"];
            for (let i = 0; i < usage.slots.length; i++) {
                lines.push(`  Slot ${i}: ${usage.slots[i] ? "USED" : "empty"}`);
            }
            if (usage.named && usage.named.length > 0) {
                lines.push("\nNamed save states:");
                for (const ns of usage.named) {
                    lines.push(`  "${ns.name}" → ${ns.filepath}`);
                }
            }
            return {
                content: [{ type: "text", text: lines.join("\n") }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_savestate_save", "Save the current emulator state to a slot (0-9) or by name. Useful for creating snapshots during analysis.", {
        slot: zod_1.z
            .number()
            .min(0)
            .max(9)
            .optional()
            .describe("Slot number 0-9"),
        name: zod_1.z
            .string()
            .optional()
            .describe("Named save state (alternative to slot)"),
    }, async ({ slot, name }) => {
        try {
            let result;
            if (slot !== undefined) {
                result = await client.saveSaveState(slot);
            }
            else if (name) {
                result = await client.saveNamedState(name);
            }
            else {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: provide either slot or name.",
                        },
                    ],
                    isError: true,
                };
            }
            return {
                content: [{ type: "text", text: result }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_savestate_load", "Load a previously saved emulator state from a slot (0-9) or by name. Restores the full CPU/memory/GPU state.", {
        slot: zod_1.z
            .number()
            .min(0)
            .max(9)
            .optional()
            .describe("Slot number 0-9"),
        name: zod_1.z
            .string()
            .optional()
            .describe("Named save state (alternative to slot)"),
    }, async ({ slot, name }) => {
        try {
            let result;
            if (slot !== undefined) {
                result = await client.loadSaveState(slot);
            }
            else if (name) {
                result = await client.loadNamedState(name);
            }
            else {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: provide either slot or name.",
                        },
                    ],
                    isError: true,
                };
            }
            return {
                content: [{ type: "text", text: result }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_get_vram", "Dump the PSX GPU VRAM (1MB, 1024x512 16bpp). Returns base64-encoded raw pixel data. Useful for analyzing textures, tilemaps, and framebuffer content.", {}, async () => {
        try {
            const data = await client.getVram();
            return {
                content: [
                    {
                        type: "text",
                        text: `VRAM dump: ${data.length} bytes (1024x512 16bpp)\nBase64: ${data.toString("base64")}`,
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
    server.tool("pcsx_screenshot", "Take a screenshot of the current PSX display output. Returns a PNG image as base64.", {}, async () => {
        try {
            const data = await client.getScreenshot();
            return {
                content: [
                    {
                        type: "image",
                        data: data.toString("base64"),
                        mimeType: "image/png",
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
//# sourceMappingURL=savestate.js.map
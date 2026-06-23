"use strict";
/**
 * MCP Tools: PSX controller input simulation.
 *
 * PSX buttons use active-low logic: a bit set to 0 in the override mask forces
 * a button pressed regardless of physical controller state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInputTools = registerInputTools;
const zod_1 = require("zod");
const BUTTON_NAMES = [
    "select",
    "start",
    "up",
    "right",
    "down",
    "left",
    "l1",
    "l2",
    "r1",
    "r2",
    "triangle",
    "circle",
    "cross",
    "square",
];
const buttonSchema = zod_1.z
    .enum(BUTTON_NAMES)
    .describe("PSX button name: select, start, up, right, down, left, l1, l2, r1, r2, triangle, circle, cross, square");
const portSchema = zod_1.z
    .number()
    .min(1)
    .max(2)
    .default(1)
    .describe("Controller port: 1 (default) or 2");
function registerInputTools(server, client) {
    // ── Press (tap) ──────────────────────────────────────────────────────────
    server.tool("pcsx_press_button", "Simulate a PSX controller button tap: hold for duration_ms then release automatically. Use for menu navigation, confirmations, or quick inputs.", {
        button: buttonSchema,
        port: portSchema,
        duration_ms: zod_1.z
            .number()
            .min(1)
            .max(5000)
            .default(100)
            .describe("How long to hold the button in milliseconds (default 100ms)"),
    }, async ({ button, port, duration_ms }) => {
        try {
            await client.padPress(port, button);
            await new Promise((resolve) => setTimeout(resolve, duration_ms));
            await client.padRelease(port, button);
            return {
                content: [
                    {
                        type: "text",
                        text: `Button '${button}' tapped for ${duration_ms}ms on port ${port}.`,
                    },
                ],
            };
        }
        catch (e) {
            // Best-effort release on error
            try {
                await client.padRelease(port, button);
            }
            catch { }
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    // ── Hold ─────────────────────────────────────────────────────────────────
    server.tool("pcsx_hold_button", "Hold a PSX controller button pressed indefinitely. The override persists until pcsx_release_button or pcsx_release_all_buttons is called. Useful for sustained directional input or holding L2/R2.", {
        button: buttonSchema,
        port: portSchema,
    }, async ({ button, port }) => {
        try {
            await client.padPress(port, button);
            return {
                content: [
                    {
                        type: "text",
                        text: `Button '${button}' is now held on port ${port}. Call pcsx_release_button to release it.`,
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
    // ── Release single ───────────────────────────────────────────────────────
    server.tool("pcsx_release_button", "Release the override on a single PSX controller button. Used after pcsx_hold_button.", {
        button: buttonSchema,
        port: portSchema,
    }, async ({ button, port }) => {
        try {
            await client.padRelease(port, button);
            return {
                content: [
                    {
                        type: "text",
                        text: `Button '${button}' override released on port ${port}.`,
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
    // ── Release all ──────────────────────────────────────────────────────────
    server.tool("pcsx_release_all_buttons", "Reset all controller button overrides on a port. Always call this on cleanup to avoid stuck buttons.", {
        port: portSchema,
    }, async ({ port }) => {
        try {
            await client.padReset(port);
            return {
                content: [
                    {
                        type: "text",
                        text: `All button overrides cleared on port ${port}.`,
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
    // ── Get pad state ────────────────────────────────────────────────────────
    server.tool("pcsx_get_pad_state", "Get the current controller override state for both ports. Shows which buttons are currently force-pressed by the MCP server.", {}, async () => {
        try {
            const state = await client.getPadState();
            const lines = [];
            for (const portKey of ["port1", "port2"]) {
                const p = state[portKey];
                const held = Object.entries(p.pressed)
                    .filter(([, v]) => v)
                    .map(([k]) => k);
                lines.push(`${portKey}: ${held.length === 0 ? "no overrides" : held.join(", ")} (raw: 0x${p.overrides_raw.toString(16).padStart(4, "0")})`);
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
}
//# sourceMappingURL=input.js.map
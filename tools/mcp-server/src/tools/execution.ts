/**
 * MCP Tools: Execution control (pause, resume, reset, status).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PcsxClient } from "../pcsx-client.js";

export function registerExecutionTools(
  server: McpServer,
  client: PcsxClient
) {
  server.tool(
    "pcsx_get_status",
    "Get the current state of the PCSX-Redux emulator (running/paused, dynarec, RAM size, debugger enabled)",
    {},
    async () => {
      try {
        const status = await client.getStatus();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "pcsx_pause",
    "Pause the PSX emulator execution",
    {},
    async () => {
      try {
        await client.pause();
        return {
          content: [{ type: "text" as const, text: "Emulator paused." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "pcsx_resume",
    "Resume the PSX emulator execution",
    {},
    async () => {
      try {
        await client.resume();
        return {
          content: [{ type: "text" as const, text: "Emulator resumed." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "pcsx_reset",
    "Reset the PSX emulator (hard or soft reset)",
    {
      type: z
        .enum(["hard", "soft"])
        .default("soft")
        .describe("Type of reset: 'hard' or 'soft'"),
    },
    async ({ type }) => {
      try {
        await client.reset(type);
        return {
          content: [
            { type: "text" as const, text: `Emulator ${type} reset done.` },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "pcsx_flush_cache",
    "Flush the PSX CPU instruction cache",
    {},
    async () => {
      try {
        await client.flushCache();
        return {
          content: [{ type: "text" as const, text: "CPU cache flushed." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );
}

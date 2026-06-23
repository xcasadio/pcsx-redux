/**
 * MCP Tools: CD-ROM access and symbol management.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PcsxClient } from "../pcsx-client.js";

export function registerCdromTools(
  server: McpServer,
  client: PcsxClient
) {
  server.tool(
    "pcsx_cdrom_info",
    "Get information about the currently loaded CD-ROM disc image: game ID, label, track count, and track types/durations.",
    {},
    async () => {
      try {
        const info = await client.getCdromInfo();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(info, null, 2),
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
    "pcsx_cdrom_read_file",
    "Read a file from the currently loaded CD-ROM ISO 9660 filesystem. Returns the file content as base64. Use paths like '\\SLUS_006.62;1' or '\\DATA\\MAP01.BIN;1'.",
    {
      filename: z
        .string()
        .describe(
          "ISO 9660 file path (e.g. '\\\\SLUS_006.62;1' or '\\\\DATA\\\\FILE.BIN;1')"
        ),
    },
    async ({ filename }) => {
      try {
        const data = await client.readCdFile(filename);
        const sizeKb = (data.length / 1024).toFixed(1);
        // If the file is small enough, try to show as text
        let preview = "";
        if (data.length <= 2048) {
          // Show hex dump for small files
          const lines: string[] = [];
          for (let i = 0; i < data.length; i += 16) {
            const chunk = data.subarray(i, Math.min(i + 16, data.length));
            const hex = Array.from(chunk)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" ");
            const ascii = Array.from(chunk)
              .map((b) =>
                b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."
              )
              .join("");
            lines.push(
              `${i.toString(16).padStart(8, "0")}: ${hex.padEnd(48)}  |${ascii}|`
            );
          }
          preview = "\n\nHex preview:\n" + lines.join("\n");
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `File: ${filename}\nSize: ${data.length} bytes (${sizeKb} KB)\nBase64: ${data.toString("base64")}${preview}`,
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
    "pcsx_upload_symbols",
    "Upload symbol names (function/variable names) to the PCSX-Redux debugger. This makes disassembly output more readable. Format: object mapping hex addresses to names.",
    {
      symbols: z
        .record(z.string(), z.string())
        .describe(
          "Map of hex address → symbol name. Example: { '80010000': 'GameMain', '80012080': 'InitHeap' }"
        ),
    },
    async ({ symbols }) => {
      try {
        await client.uploadSymbols(symbols);
        return {
          content: [
            {
              type: "text" as const,
              text: `Uploaded ${Object.keys(symbols).length} symbol(s) to PCSX-Redux.`,
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
    "pcsx_reset_symbols",
    "Clear all symbols from the PCSX-Redux debugger.",
    {},
    async () => {
      try {
        await client.resetSymbols();
        return {
          content: [
            { type: "text" as const, text: "All symbols cleared." },
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
}

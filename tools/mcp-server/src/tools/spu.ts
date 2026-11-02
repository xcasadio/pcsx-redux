/**
 * MCP Tools: WAV capture of the SPU voices.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PcsxClient } from "../pcsx-client.js";
import { SpuCaptureStatus } from "../types.js";

function statusResult(status: SpuCaptureStatus) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(status) }],
  };
}

function errorResult(e: any) {
  return {
    content: [{ type: "text" as const, text: `Error: ${e.message}` }],
    isError: true,
  };
}

export function registerSpuTools(server: McpServer, client: PcsxClient) {
  server.tool(
    "pcsx_spu_capture_status",
    "Report the running or last WAV capture of the SPU mix: active, failed, frames, discontinuities, sample rate, the volume, interpolation and reverb settings, and the resolved path. The file is one continuous mix only when discontinuities is 0.",
    {},
    async () => {
      try {
        return statusResult(await client.getSpuCaptureStatus());
      } catch (e: any) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "pcsx_spu_capture_start",
    "Start writing the SPU mix to a 16-bit stereo 44.1 kHz WAV file, as it leaves the mixer and before the audio backend: voices after interpolation, reverb return, division by 4 - volume. XA and CDDA are not in the file unless a voice plays the CD capture area of SPU RAM. A relative path is resolved against the persistent directory.",
    {
      filepath: z.string().min(1).describe("Path of the WAV file to write"),
    },
    async ({ filepath }) => {
      try {
        return statusResult(await client.startSpuCapture(filepath));
      } catch (e: any) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "pcsx_spu_capture_stop",
    "Stop the running SPU capture and finish its WAV file. Reports the number of frames written.",
    {},
    async () => {
      try {
        return statusResult(await client.stopSpuCapture());
      } catch (e: any) {
        return errorResult(e);
      }
    }
  );
}

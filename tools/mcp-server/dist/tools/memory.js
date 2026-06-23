"use strict";
/**
 * MCP Tools: Memory read/write/search operations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMemoryTools = registerMemoryTools;
const zod_1 = require("zod");
function parseAddress(addr) {
    if (addr.startsWith("0x") || addr.startsWith("0X")) {
        return parseInt(addr, 16);
    }
    return parseInt(addr, 10);
}
function formatHexdump(data, baseAddress, bytesPerLine = 16) {
    const lines = [];
    for (let offset = 0; offset < data.length; offset += bytesPerLine) {
        const addr = (baseAddress + offset) >>> 0;
        const chunk = data.subarray(offset, Math.min(offset + bytesPerLine, data.length));
        const hexParts = [];
        for (let i = 0; i < bytesPerLine; i++) {
            if (i === bytesPerLine / 2)
                hexParts.push("");
            if (i < chunk.length) {
                hexParts.push(chunk[i].toString(16).padStart(2, "0"));
            }
            else {
                hexParts.push("  ");
            }
        }
        const ascii = Array.from(chunk)
            .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
            .join("");
        lines.push(`${addr.toString(16).padStart(8, "0")}: ${hexParts.join(" ")}  |${ascii}|`);
    }
    return lines.join("\n");
}
function registerMemoryTools(server, client) {
    server.tool("pcsx_read_memory", "Read N bytes from PSX RAM at a given address. Returns a hex dump with ASCII. Addresses are automatically mirrored (0x80000000/0xA0000000/0x00000000 all map to same physical RAM).", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000') or decimal"),
        size: zod_1.z
            .number()
            .min(1)
            .max(65536)
            .default(256)
            .describe("Number of bytes to read (1-65536, default 256)"),
    }, async ({ address, size }) => {
        try {
            const addr = parseAddress(address);
            const data = await client.readMemory(addr, size);
            const hexdump = formatHexdump(data, addr);
            return {
                content: [{ type: "text", text: hexdump }],
            };
        }
        catch (e) {
            return {
                content: [{ type: "text", text: `Error: ${e.message}` }],
                isError: true,
            };
        }
    });
    server.tool("pcsx_read_memory_raw", "Read N bytes from PSX RAM and return as base64-encoded binary. Use for programmatic analysis of larger blocks.", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000') or decimal"),
        size: zod_1.z
            .number()
            .min(1)
            .max(65536)
            .default(256)
            .describe("Number of bytes to read (1-65536)"),
    }, async ({ address, size }) => {
        try {
            const addr = parseAddress(address);
            const data = await client.readMemory(addr, size);
            return {
                content: [
                    {
                        type: "text",
                        text: `Address: 0x${addr.toString(16)}, Size: ${data.length} bytes\nBase64: ${data.toString("base64")}`,
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
    server.tool("pcsx_write_memory", "Write bytes to PSX RAM at a given address. Data is provided as hex string (e.g. '00112233').", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000') or decimal"),
        data: zod_1.z
            .string()
            .describe("Data to write as hex string (e.g. '00112233AABBCCDD')"),
    }, async ({ address, data }) => {
        try {
            const addr = parseAddress(address);
            const buf = Buffer.from(data, "hex");
            if (buf.length === 0)
                throw new Error("Invalid hex data string");
            await client.writeMemory(addr, buf);
            return {
                content: [
                    {
                        type: "text",
                        text: `Wrote ${buf.length} bytes to 0x${addr.toString(16)}.`,
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
    server.tool("pcsx_search_memory", "Search for a hex byte pattern in PSX RAM. Returns all found addresses (max 100). Useful for finding strings, function signatures, or data structures.", {
        pattern: zod_1.z
            .string()
            .describe("Hex byte pattern to search for (e.g. '504152415349' for 'PARASI')"),
        offset: zod_1.z
            .string()
            .optional()
            .describe("Start offset in RAM (hex or decimal, default 0)"),
    }, async ({ pattern, offset }) => {
        try {
            const searchBytes = Buffer.from(pattern, "hex");
            if (searchBytes.length === 0)
                throw new Error("Invalid hex pattern");
            const startOffset = offset ? parseAddress(offset) : 0;
            const ram = await client.readRamFull();
            const results = [];
            const maxResults = 100;
            for (let i = startOffset; i <= ram.length - searchBytes.length; i++) {
                let match = true;
                for (let j = 0; j < searchBytes.length; j++) {
                    if (ram[i + j] !== searchBytes[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    const psx_addr = 0x80000000 + i;
                    const context = ram.subarray(i, Math.min(i + 32, ram.length));
                    results.push(`0x${psx_addr.toString(16).padStart(8, "0")}: ${Array.from(context)
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join(" ")}`);
                    if (results.length >= maxResults)
                        break;
                }
            }
            if (results.length === 0) {
                return {
                    content: [{ type: "text", text: "Pattern not found in RAM." }],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${results.length} match(es):\n${results.join("\n")}`,
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
    server.tool("pcsx_read_word", "Read a 32-bit word (uint32) at a PSX address. Returns the value in decimal, hex, and as signed int32.", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000') or decimal"),
    }, async ({ address }) => {
        try {
            const addr = parseAddress(address);
            const data = await client.readMemory(addr, 4);
            const value = data.readUInt32LE(0);
            const signed = data.readInt32LE(0);
            return {
                content: [
                    {
                        type: "text",
                        text: `[0x${addr.toString(16)}] = 0x${value.toString(16).padStart(8, "0")} (${value} unsigned, ${signed} signed)`,
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
    server.tool("pcsx_read_string", "Read a null-terminated ASCII string from PSX RAM at a given address.", {
        address: zod_1.z
            .string()
            .describe("PSX address in hex (e.g. '0x80010000') or decimal"),
        maxLength: zod_1.z
            .number()
            .min(1)
            .max(4096)
            .default(256)
            .describe("Maximum string length to read (default 256)"),
    }, async ({ address, maxLength }) => {
        try {
            const addr = parseAddress(address);
            const data = await client.readMemory(addr, maxLength);
            const nullIdx = data.indexOf(0);
            const str = data.subarray(0, nullIdx >= 0 ? nullIdx : data.length).toString("ascii");
            return {
                content: [
                    {
                        type: "text",
                        text: `[0x${addr.toString(16)}]: "${str}" (${str.length} chars)`,
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
//# sourceMappingURL=memory.js.map
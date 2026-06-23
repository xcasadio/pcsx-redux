"use strict";
/**
 * MCP Tools: CPU registers and disassembly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDisassemblyTools = registerDisassemblyTools;
const zod_1 = require("zod");
function parseAddress(addr) {
    if (addr.startsWith("0x") || addr.startsWith("0X")) {
        return parseInt(addr, 16);
    }
    return parseInt(addr, 10);
}
function registerDisassemblyTools(server, client) {
    server.tool("pcsx_get_registers", "Read all MIPS R3000A CPU registers: GPR (r0-ra, lo, hi), CP0 (Status, Cause, EPC, etc.), CP2 (GTE data/control), PC (program counter), and current cycle count.", {}, async () => {
        try {
            const regs = await client.getRegisters();
            const lines = [];
            lines.push(`PC: 0x${(regs.pc >>> 0).toString(16).padStart(8, "0")}  Cycle: ${regs.cycle}`);
            lines.push("");
            lines.push("=== GPR ===");
            const gprOrder = [
                "r0", "at", "v0", "v1", "a0", "a1", "a2", "a3",
                "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
                "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
                "t8", "t9", "k0", "k1", "gp", "sp", "s8", "ra",
                "lo", "hi",
            ];
            for (let i = 0; i < gprOrder.length; i += 4) {
                const chunk = gprOrder.slice(i, i + 4);
                lines.push(chunk
                    .map((name) => `${name.padEnd(3)}: 0x${((regs.gpr[name] ?? 0) >>> 0).toString(16).padStart(8, "0")}`)
                    .join("  "));
            }
            lines.push("");
            lines.push("=== CP0 ===");
            const cp0Important = ["Status", "Cause", "EPC", "BadVAddr", "PRid", "DCIC", "BPC", "BPCM"];
            for (const name of cp0Important) {
                if (regs.cp0[name] !== undefined) {
                    lines.push(`${name.padEnd(10)}: 0x${((regs.cp0[name] ?? 0) >>> 0).toString(16).padStart(8, "0")}`);
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
    server.tool("pcsx_get_pc", "Get the current Program Counter (PC) value of the MIPS CPU.", {}, async () => {
        try {
            const regs = await client.getRegisters();
            return {
                content: [
                    {
                        type: "text",
                        text: `PC: 0x${(regs.pc >>> 0).toString(16).padStart(8, "0")}`,
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
    server.tool("pcsx_disassemble", "Disassemble MIPS R3000A instructions at a given PSX address. Returns formatted assembly listing with addresses, opcodes, and mnemonics. Also shows symbol names if available.", {
        address: zod_1.z
            .string()
            .describe("PSX address to disassemble from, in hex (e.g. '0x80010000') or decimal. Use 'pc' to disassemble at current PC."),
        count: zod_1.z
            .number()
            .min(1)
            .max(200)
            .default(20)
            .describe("Number of instructions to disassemble (1-200, default 20)"),
    }, async ({ address, count }) => {
        try {
            let addr;
            if (address.toLowerCase() === "pc") {
                const regs = await client.getRegisters();
                addr = regs.pc;
            }
            else {
                addr = parseAddress(address);
            }
            const result = await client.disassemble(addr, count);
            const lines = [];
            let currentSymbol = "";
            for (const instr of result.instructions) {
                if (instr.symbol && instr.symbol !== currentSymbol) {
                    if (lines.length > 0)
                        lines.push("");
                    lines.push(`${instr.symbol}:`);
                    currentSymbol = instr.symbol;
                }
                lines.push(`  ${instr.addressHex}:  ${instr.opcodeHex.slice(2)}   ${instr.disassembly}`);
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
    server.tool("pcsx_analyze_function", "Analyze a function starting at a given address. Disassembles until a 'jr $ra' is found (or max 500 instructions). Returns the full function listing with prologue/epilogue annotation.", {
        address: zod_1.z
            .string()
            .describe("PSX address of the function start, in hex (e.g. '0x80010000')"),
    }, async ({ address }) => {
        try {
            const addr = parseAddress(address);
            const instructions = [];
            const maxInstructions = 500;
            const batchSize = 200;
            let nextAddr = addr;
            let needDelaySlot = false;
            let done = false;
            while (instructions.length < maxInstructions && !done) {
                const remaining = maxInstructions - instructions.length;
                const count = needDelaySlot ? 1 : Math.min(batchSize, remaining);
                const result = await client.disassemble(nextAddr, count);
                if (result.instructions.length === 0) {
                    break;
                }
                for (const instr of result.instructions) {
                    instructions.push(instr);
                    nextAddr = (instr.address + 4) >>> 0;
                    if (needDelaySlot) {
                        needDelaySlot = false;
                        done = true;
                        break;
                    }
                    const disasm = instr.disassembly.toLowerCase().trim();
                    if (disasm.startsWith("jr") && disasm.includes("ra")) {
                        needDelaySlot = true;
                    }
                    if (instructions.length >= maxInstructions) {
                        done = true;
                        break;
                    }
                }
            }
            const lines = [];
            let currentSymbol = "";
            for (const instr of instructions) {
                if (instr.symbol && instr.symbol !== currentSymbol) {
                    if (lines.length > 0)
                        lines.push("");
                    lines.push(`${instr.symbol}:`);
                    currentSymbol = instr.symbol;
                }
                lines.push(`  ${instr.addressHex}:  ${instr.opcodeHex.slice(2)}   ${instr.disassembly}`);
            }
            const sizeBytes = instructions.length * 4;
            lines.unshift(`; Function at 0x${addr.toString(16)} — ${instructions.length} instructions (${sizeBytes} bytes)`);
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
//# sourceMappingURL=disassembly.js.map
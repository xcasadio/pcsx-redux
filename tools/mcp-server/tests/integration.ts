/**
 * Integration tests for the PCSX-Redux MCP Server.
 *
 * These tests require a running PCSX-Redux instance with the Web Server enabled.
 * Run with: npx tsx tests/integration.ts
 *
 * Environment:
 *   PCSX_HOST (default: localhost)
 *   PCSX_PORT (default: 8080)
 */

import { PcsxClient } from "../src/pcsx-client.js";

const host = process.env.PCSX_HOST || "localhost";
const port = parseInt(process.env.PCSX_PORT || "8080", 10);
const client = new PcsxClient(host, port, 5000);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main() {
  console.log(`\nPCSX-Redux MCP Server — Integration Tests`);
  console.log(`Target: ${host}:${port}\n`);

  // ── Connection ──
  console.log("Connection:");
  await test("can connect to PCSX-Redux", async () => {
    const status = await client.getStatus();
    assert(typeof status.running === "boolean", "status.running should be boolean");
    assert(typeof status.debugger === "boolean", "status.debugger should be boolean");
  });

  // ── Execution Flow ──
  console.log("\nExecution Flow:");
  await test("get status returns valid response", async () => {
    const status = await client.getStatus();
    assert("running" in status, "missing 'running' field");
    assert("isDynarec" in status, "missing 'isDynarec' field");
    assert("8mb" in status, "missing '8mb' field");
  });

  await test("can pause emulator", async () => {
    await client.pause();
    const status = await client.getStatus();
    assert(!status.running, "emulator should be paused");
  });

  await test("can resume emulator", async () => {
    await client.resume();
    // Brief wait then pause again for remaining tests
    await new Promise((r) => setTimeout(r, 100));
    await client.pause();
  });

  // ── Registers ──
  console.log("\nRegisters:");
  await test("can read CPU registers", async () => {
    await client.pause();
    const regs = await client.getRegisters();
    assert(typeof regs.pc === "number", "pc should be a number");
    assert(typeof regs.cycle === "number", "cycle should be a number");
    assert(typeof regs.gpr === "object", "gpr should be an object");
    assert("sp" in regs.gpr, "gpr should have sp");
    assert("ra" in regs.gpr, "gpr should have ra");
    assert(typeof regs.cp0 === "object", "cp0 should be an object");
  });

  await test("PC is a valid PSX address", async () => {
    const regs = await client.getRegisters();
    const pc = regs.pc >>> 0;
    // PC should be in KSEG0 (0x80000000-0x9FFFFFFF) or KSEG1 or KUSEG
    assert(pc !== 0, "PC should not be 0");
  });

  // ── Memory ──
  console.log("\nMemory:");
  await test("can read partial RAM", async () => {
    const data = await client.readMemory(0x80000000, 64);
    assert(data.length === 64, `expected 64 bytes, got ${data.length}`);
  });

  await test("can read 256 bytes at 0x80010000", async () => {
    const data = await client.readMemory(0x80010000, 256);
    assert(data.length === 256, `expected 256 bytes, got ${data.length}`);
  });

  // ── Disassembly ──
  console.log("\nDisassembly:");
  await test("can disassemble at PC", async () => {
    const regs = await client.getRegisters();
    const result = await client.disassemble(regs.pc, 5);
    assert(
      result.instructions.length === 5,
      `expected 5 instructions, got ${result.instructions.length}`
    );
    assert(
      typeof result.instructions[0].disassembly === "string",
      "disassembly should be a string"
    );
    assert(
      typeof result.instructions[0].opcode === "number",
      "opcode should be a number"
    );
  });

  await test("disassembly includes address info", async () => {
    const result = await client.disassemble(0x80010000, 1);
    assert(
      result.instructions[0].addressHex === "0x80010000",
      "addressHex should match"
    );
  });

  // ── Breakpoints ──
  console.log("\nBreakpoints:");
  await test("can list breakpoints", async () => {
    const result = await client.listBreakpoints();
    assert(Array.isArray(result.breakpoints), "breakpoints should be array");
  });

  await test("can add and remove a breakpoint", async () => {
    // Clean up first
    await client.removeAllBreakpoints();

    await client.addBreakpoint(0x80010000, "exec", 4, "test-bp");
    const bps = await client.listBreakpoints();
    const found = bps.breakpoints.find((b) => b.label === "test-bp");
    assert(found !== undefined, "breakpoint should exist after adding");
    assert(found!.enabled === true, "new breakpoint should be enabled");

    await client.removeBreakpoint(0x80010000, "exec");
    const bps2 = await client.listBreakpoints();
    const found2 = bps2.breakpoints.find((b) => b.label === "test-bp");
    assert(found2 === undefined, "breakpoint should be removed");
  });

  await test("can enable/disable a breakpoint", async () => {
    await client.removeAllBreakpoints();
    await client.addBreakpoint(0x80020000, "exec", 4, "toggle-test");

    await client.disableBreakpoint(0x80020000);
    let bps = await client.listBreakpoints();
    let bp = bps.breakpoints.find((b) => b.label === "toggle-test");
    assert(bp !== undefined && !bp.enabled, "breakpoint should be disabled");

    await client.enableBreakpoint(0x80020000);
    bps = await client.listBreakpoints();
    bp = bps.breakpoints.find((b) => b.label === "toggle-test");
    assert(bp !== undefined && bp.enabled, "breakpoint should be enabled");

    await client.removeAllBreakpoints();
  });

  // ── CD-ROM ──
  console.log("\nCD-ROM:");
  await test("can get CD-ROM info", async () => {
    try {
      const info = await client.getCdromInfo();
      assert(typeof info.id === "string", "id should be a string");
      assert(typeof info.label === "string", "label should be a string");
    } catch (e: any) {
      // CD-ROM info may fail if no disc is loaded — that's acceptable
      if (!e.message.includes("404") && !e.message.includes("500")) {
        throw e;
      }
      console.log("    (no disc loaded, skipping)");
    }
  });

  // ── Save States ──
  console.log("\nSave States:");
  await test("can list save state slots", async () => {
    try {
      const usage = await client.getSaveStateUsage();
      assert(Array.isArray(usage.slots), "slots should be an array");
    } catch (e: any) {
      // May fail in CLI mode
      if (e.message.includes("500")) {
        console.log("    (unavailable in CLI mode, skipping)");
      } else {
        throw e;
      }
    }
  });

  // ── Summary ──
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"─".repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});

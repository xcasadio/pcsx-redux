/**
 * Shared types for the PCSX-Redux MCP Server.
 */

export interface PcsxRegisters {
  pc: number;
  code: number;
  cycle: number;
  gpr: Record<string, number>;
  cp0: Record<string, number>;
  cp2d: Record<string, number>;
  cp2c: Record<string, number>;
}

export interface PcsxStatus {
  running: boolean;
  isDynarec: boolean;
  "8mb": boolean;
  debugger: boolean;
}

export interface DisassembledInstruction {
  address: number;
  addressHex: string;
  opcode: number;
  opcodeHex: string;
  disassembly: string;
  symbol?: string;
}

export interface Breakpoint {
  address: number;
  addressHex: string;
  type: "Exec" | "Read" | "Write";
  width: number;
  label: string;
  enabled: boolean;
  source: string;
}

export interface CdromInfo {
  id: string;
  label: string;
  iso: {
    TN: number;
    tracktype: Record<number, string>;
    TD: Record<number, { m: number; s: number; f: number }>;
  };
}

export interface SaveStateSlotInfo {
  slots: boolean[];
  named?: Array<{ name: string; filepath: string }>;
}

export interface SpuCaptureStatus {
  active: boolean;
  failed: boolean;
  frames: number;
  discontinuities: number;
  sampleRate: number;
  volume: number;
  interpolation: number;
  reverb: number;
  path: string;
}

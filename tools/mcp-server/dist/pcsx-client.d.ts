/**
 * HTTP client for communicating with the PCSX-Redux web server API.
 */
import { PcsxRegisters, PcsxStatus, DisassembledInstruction, Breakpoint, CdromInfo, SaveStateSlotInfo, SpuCaptureStatus } from "./types.js";
export declare class PcsxClient {
    private baseUrl;
    private timeout;
    constructor(host?: string, port?: number, timeout?: number);
    private request;
    private getJson;
    private getAction;
    private postAction;
    getStatus(): Promise<PcsxStatus>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    reset(type?: "hard" | "soft"): Promise<void>;
    getRegisters(): Promise<PcsxRegisters>;
    readRamFull(): Promise<Buffer>;
    readMemory(address: number, size: number): Promise<Buffer>;
    writeMemory(address: number, data: Buffer): Promise<void>;
    disassemble(address: number, count?: number): Promise<{
        instructions: DisassembledInstruction[];
    }>;
    listBreakpoints(): Promise<{
        breakpoints: Breakpoint[];
    }>;
    addBreakpoint(address: number, type?: "exec" | "read" | "write", width?: number, label?: string): Promise<void>;
    removeBreakpoint(address: number, type?: "exec" | "read" | "write"): Promise<void>;
    enableBreakpoint(address: number): Promise<void>;
    disableBreakpoint(address: number): Promise<void>;
    removeAllBreakpoints(): Promise<void>;
    flushCache(): Promise<void>;
    uploadSymbols(symbols: Record<string, string>): Promise<void>;
    resetSymbols(): Promise<void>;
    getCdromInfo(): Promise<CdromInfo>;
    readCdFile(filename: string): Promise<Buffer>;
    getSaveStateUsage(): Promise<SaveStateSlotInfo>;
    saveSaveState(slot: number): Promise<string>;
    loadSaveState(slot: number): Promise<string>;
    saveNamedState(name: string): Promise<string>;
    loadNamedState(name: string): Promise<string>;
    deleteNamedState(name: string): Promise<string>;
    deleteSaveState(slot: number): Promise<string>;
    padPress(port: number, button: string): Promise<void>;
    padRelease(port: number, button: string): Promise<void>;
    padReset(port: number): Promise<void>;
    getPadState(): Promise<any>;
    getVram(): Promise<Buffer>;
    getScreenshot(): Promise<Buffer>;
    getSpuCaptureStatus(): Promise<SpuCaptureStatus>;
    startSpuCapture(filepath: string): Promise<SpuCaptureStatus>;
    stopSpuCapture(): Promise<SpuCaptureStatus>;
    executeLua(handler: string, body?: string): Promise<string>;
}
//# sourceMappingURL=pcsx-client.d.ts.map
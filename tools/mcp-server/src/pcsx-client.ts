/**
 * HTTP client for communicating with the PCSX-Redux web server API.
 */

import {
  PcsxRegisters,
  PcsxStatus,
  DisassembledInstruction,
  Breakpoint,
  CdromInfo,
  SaveStateSlotInfo,
  SpuCaptureStatus,
} from "./types.js";

export class PcsxClient {
  private baseUrl: string;
  private timeout: number;

  constructor(
    host: string = "localhost",
    port: number = 8080,
    timeout: number = 10000
  ) {
    this.baseUrl = `http://${host}:${port}`;
    this.timeout = timeout;
  }

  private async request(
    path: string,
    options: {
      method?: string;
      body?: Uint8Array | string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const resp = await fetch(url, {
        method: options.method || "GET",
        body: options.body as any,
        headers: options.headers,
        signal: controller.signal,
      });
      return resp;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const resp = await this.request(path);
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return (await resp.json()) as T;
  }

  private async getAction(path: string): Promise<string> {
    const resp = await this.request(path);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text}`);
    return text;
  }

  private async postAction(
    path: string,
    body?: Buffer | string,
    headers?: Record<string, string>
  ): Promise<string> {
    const resp = await this.request(path, {
      method: "POST",
      body,
      headers,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text}`);
    return text;
  }

  // ── Execution Flow ──

  async getStatus(): Promise<PcsxStatus> {
    return this.getJson<PcsxStatus>("/api/v1/execution-flow");
  }

  async pause(): Promise<void> {
    await this.postAction("/api/v1/execution-flow?function=pause");
  }

  async resume(): Promise<void> {
    await this.postAction("/api/v1/execution-flow?function=resume");
  }

  async reset(type: "hard" | "soft" = "soft"): Promise<void> {
    await this.postAction(
      `/api/v1/execution-flow?function=reset&type=${type}`
    );
  }

  // ── CPU Registers ──

  async getRegisters(): Promise<PcsxRegisters> {
    return this.getJson<PcsxRegisters>("/api/v1/cpu/registers");
  }

  // ── Memory ──

  async readRamFull(): Promise<Buffer> {
    const resp = await this.request("/api/v1/cpu/ram/raw");
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async readMemory(address: number, size: number): Promise<Buffer> {
    const addrHex = "0x" + address.toString(16);
    const resp = await this.request(
      `/api/v1/cpu/ram?addr=${addrHex}&size=${size}`
    );
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async writeMemory(
    address: number,
    data: Buffer
  ): Promise<void> {
    const resp = await this.request(
      `/api/v1/cpu/ram/raw?offset=${address & 0x1fffff}&size=${data.length}`,
      {
        method: "POST",
        body: data,
        headers: { "Content-Type": "application/octet-stream" },
      }
    );
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  // ── Disassembly ──

  async disassemble(
    address: number,
    count: number = 20
  ): Promise<{ instructions: DisassembledInstruction[] }> {
    const addrHex = "0x" + address.toString(16);
    return this.getJson(`/api/v1/cpu/disassemble?addr=${addrHex}&count=${count}`);
  }

  // ── Breakpoints ──

  async listBreakpoints(): Promise<{ breakpoints: Breakpoint[] }> {
    return this.getJson("/api/v1/cpu/breakpoints");
  }

  async addBreakpoint(
    address: number,
    type: "exec" | "read" | "write" = "exec",
    width: number = 4,
    label: string = ""
  ): Promise<void> {
    const addrHex = "0x" + address.toString(16);
    let url = `/api/v1/cpu/breakpoints?function=add&addr=${addrHex}&type=${type}&width=${width}`;
    if (label) url += `&label=${encodeURIComponent(label)}`;
    await this.postAction(url);
  }

  async removeBreakpoint(
    address: number,
    type: "exec" | "read" | "write" = "exec"
  ): Promise<void> {
    const addrHex = "0x" + address.toString(16);
    await this.postAction(
      `/api/v1/cpu/breakpoints?function=remove&addr=${addrHex}&type=${type}`
    );
  }

  async enableBreakpoint(address: number): Promise<void> {
    const addrHex = "0x" + address.toString(16);
    await this.postAction(
      `/api/v1/cpu/breakpoints?function=enable&addr=${addrHex}`
    );
  }

  async disableBreakpoint(address: number): Promise<void> {
    const addrHex = "0x" + address.toString(16);
    await this.postAction(
      `/api/v1/cpu/breakpoints?function=disable&addr=${addrHex}`
    );
  }

  async removeAllBreakpoints(): Promise<void> {
    await this.postAction("/api/v1/cpu/breakpoints?function=removeAll");
  }

  // ── Cache ──

  async flushCache(): Promise<void> {
    await this.postAction("/api/v1/cpu/cache?function=flush");
  }

  // ── Assembly / Symbols ──

  async uploadSymbols(
    symbols: Record<string, string>
  ): Promise<void> {
    // Format: "address name\n" per line (hex address, space, name)
    const body = Object.entries(symbols)
      .map(([addr, name]) => `${addr} ${name}`)
      .join("\n");
    await this.postAction(
      "/api/v1/assembly/symbols?function=upload",
      body
    );
  }

  async resetSymbols(): Promise<void> {
    await this.postAction("/api/v1/assembly/symbols?function=reset");
  }

  // ── CD-ROM ──

  async getCdromInfo(): Promise<CdromInfo> {
    return this.getJson<CdromInfo>("/api/v1/cd/info");
  }

  async readCdFile(filename: string): Promise<Buffer> {
    const resp = await this.request(
      `/api/v1/cd/files?filename=${encodeURIComponent(filename)}`
    );
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // ── Save States ──

  async getSaveStateUsage(): Promise<SaveStateSlotInfo> {
    return this.getJson<SaveStateSlotInfo>("/api/v1/state/usage");
  }

  async saveSaveState(slot: number): Promise<string> {
    return this.getAction(`/api/v1/state/save?slot=${slot}`);
  }

  async loadSaveState(slot: number): Promise<string> {
    return this.getAction(`/api/v1/state/load?slot=${slot}`);
  }

  async saveNamedState(name: string): Promise<string> {
    return this.getAction(
      `/api/v1/state/save?name=${encodeURIComponent(name)}`
    );
  }

  async loadNamedState(name: string): Promise<string> {
    return this.getAction(
      `/api/v1/state/load?name=${encodeURIComponent(name)}`
    );
  }

  async deleteNamedState(name: string): Promise<string> {
    return this.getAction(
      `/api/v1/state/delete?name=${encodeURIComponent(name)}`
    );
  }

  async deleteSaveState(slot: number): Promise<string> {
    return this.getAction(`/api/v1/state/delete?slot=${slot}`);
  }

  // ── Pad / Controller Input ──

  async padPress(port: number, button: string): Promise<void> {
    const resp = await this.request(
      `/api/v1/pad?port=${port}&function=press&button=${button}`,
      { method: "POST" }
    );
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  async padRelease(port: number, button: string): Promise<void> {
    const resp = await this.request(
      `/api/v1/pad?port=${port}&function=release&button=${button}`,
      { method: "POST" }
    );
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  async padReset(port: number): Promise<void> {
    const resp = await this.request(
      `/api/v1/pad?port=${port}&function=reset`,
      { method: "POST" }
    );
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  async getPadState(): Promise<any> {
    return this.getJson<any>("/api/v1/pad");
  }

  // ── GPU / VRAM ──

  async getVram(): Promise<Buffer> {
    const resp = await this.request("/api/v1/gpu/vram/raw");
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // ── Screenshot ──

  async getScreenshot(): Promise<Buffer> {
    const resp = await this.request("/api/v1/screen/still");
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // ── SPU capture ──

  async getSpuCaptureStatus(): Promise<SpuCaptureStatus> {
    return this.getJson<SpuCaptureStatus>("/api/v1/spu/capture/status");
  }

  async startSpuCapture(filepath: string): Promise<SpuCaptureStatus> {
    // The web server reads 256 bytes at a time and takes each piece of a URL for a whole one.
    // fetch escapes more than encodeURIComponent, so the length is measured on the URL it sends.
    const path = `/api/v1/spu/capture/start?filepath=${encodeURIComponent(filepath)}`;
    const sent = new URL(path, this.baseUrl);
    const length = sent.pathname.length + sent.search.length;
    if (length > 250) {
      throw new Error(
        `The encoded request is ${length} bytes, the web server takes 250: use a shorter or a relative path.`
      );
    }
    const text = await this.postAction(path);
    return JSON.parse(text) as SpuCaptureStatus;
  }

  async stopSpuCapture(): Promise<SpuCaptureStatus> {
    const text = await this.postAction("/api/v1/spu/capture/stop");
    return JSON.parse(text) as SpuCaptureStatus;
  }

  // ── Lua ──

  async executeLua(handler: string, body?: string): Promise<string> {
    const resp = await this.request(`/api/v1/lua/${handler}`, {
      method: body ? "POST" : "GET",
      body,
    });
    return resp.text();
  }
}

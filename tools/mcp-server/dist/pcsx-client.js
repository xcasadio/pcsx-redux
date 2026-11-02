"use strict";
/**
 * HTTP client for communicating with the PCSX-Redux web server API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PcsxClient = void 0;
class PcsxClient {
    baseUrl;
    timeout;
    constructor(host = "localhost", port = 8080, timeout = 10000) {
        this.baseUrl = `http://${host}:${port}`;
        this.timeout = timeout;
    }
    async request(path, options = {}) {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const resp = await fetch(url, {
                method: options.method || "GET",
                body: options.body,
                headers: options.headers,
                signal: controller.signal,
            });
            return resp;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    async getJson(path) {
        const resp = await this.request(path);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        return (await resp.json());
    }
    async getAction(path) {
        const resp = await this.request(path);
        const text = await resp.text();
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${text}`);
        return text;
    }
    async postAction(path, body, headers) {
        const resp = await this.request(path, {
            method: "POST",
            body,
            headers,
        });
        const text = await resp.text();
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${text}`);
        return text;
    }
    // ── Execution Flow ──
    async getStatus() {
        return this.getJson("/api/v1/execution-flow");
    }
    async pause() {
        await this.postAction("/api/v1/execution-flow?function=pause");
    }
    async resume() {
        await this.postAction("/api/v1/execution-flow?function=resume");
    }
    async reset(type = "soft") {
        await this.postAction(`/api/v1/execution-flow?function=reset&type=${type}`);
    }
    // ── CPU Registers ──
    async getRegisters() {
        return this.getJson("/api/v1/cpu/registers");
    }
    // ── Memory ──
    async readRamFull() {
        const resp = await this.request("/api/v1/cpu/ram/raw");
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }
    async readMemory(address, size) {
        const addrHex = "0x" + address.toString(16);
        const resp = await this.request(`/api/v1/cpu/ram?addr=${addrHex}&size=${size}`);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }
    async writeMemory(address, data) {
        const resp = await this.request(`/api/v1/cpu/ram/raw?offset=${address & 0x1fffff}&size=${data.length}`, {
            method: "POST",
            body: data,
            headers: { "Content-Type": "application/octet-stream" },
        });
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }
    // ── Disassembly ──
    async disassemble(address, count = 20) {
        const addrHex = "0x" + address.toString(16);
        return this.getJson(`/api/v1/cpu/disassemble?addr=${addrHex}&count=${count}`);
    }
    // ── Breakpoints ──
    async listBreakpoints() {
        return this.getJson("/api/v1/cpu/breakpoints");
    }
    async addBreakpoint(address, type = "exec", width = 4, label = "") {
        const addrHex = "0x" + address.toString(16);
        let url = `/api/v1/cpu/breakpoints?function=add&addr=${addrHex}&type=${type}&width=${width}`;
        if (label)
            url += `&label=${encodeURIComponent(label)}`;
        await this.postAction(url);
    }
    async removeBreakpoint(address, type = "exec") {
        const addrHex = "0x" + address.toString(16);
        await this.postAction(`/api/v1/cpu/breakpoints?function=remove&addr=${addrHex}&type=${type}`);
    }
    async enableBreakpoint(address) {
        const addrHex = "0x" + address.toString(16);
        await this.postAction(`/api/v1/cpu/breakpoints?function=enable&addr=${addrHex}`);
    }
    async disableBreakpoint(address) {
        const addrHex = "0x" + address.toString(16);
        await this.postAction(`/api/v1/cpu/breakpoints?function=disable&addr=${addrHex}`);
    }
    async removeAllBreakpoints() {
        await this.postAction("/api/v1/cpu/breakpoints?function=removeAll");
    }
    // ── Cache ──
    async flushCache() {
        await this.postAction("/api/v1/cpu/cache?function=flush");
    }
    // ── Assembly / Symbols ──
    async uploadSymbols(symbols) {
        // Format: "address name\n" per line (hex address, space, name)
        const body = Object.entries(symbols)
            .map(([addr, name]) => `${addr} ${name}`)
            .join("\n");
        await this.postAction("/api/v1/assembly/symbols?function=upload", body);
    }
    async resetSymbols() {
        await this.postAction("/api/v1/assembly/symbols?function=reset");
    }
    // ── CD-ROM ──
    async getCdromInfo() {
        return this.getJson("/api/v1/cd/info");
    }
    async readCdFile(filename) {
        const resp = await this.request(`/api/v1/cd/files?filename=${encodeURIComponent(filename)}`);
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }
    // ── Save States ──
    async getSaveStateUsage() {
        return this.getJson("/api/v1/state/usage");
    }
    async saveSaveState(slot) {
        return this.getAction(`/api/v1/state/save?slot=${slot}`);
    }
    async loadSaveState(slot) {
        return this.getAction(`/api/v1/state/load?slot=${slot}`);
    }
    async saveNamedState(name) {
        return this.getAction(`/api/v1/state/save?name=${encodeURIComponent(name)}`);
    }
    async loadNamedState(name) {
        return this.getAction(`/api/v1/state/load?name=${encodeURIComponent(name)}`);
    }
    async deleteNamedState(name) {
        return this.getAction(`/api/v1/state/delete?name=${encodeURIComponent(name)}`);
    }
    async deleteSaveState(slot) {
        return this.getAction(`/api/v1/state/delete?slot=${slot}`);
    }
    // ── Pad / Controller Input ──
    async padPress(port, button) {
        const resp = await this.request(`/api/v1/pad?port=${port}&function=press&button=${button}`, { method: "POST" });
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }
    async padRelease(port, button) {
        const resp = await this.request(`/api/v1/pad?port=${port}&function=release&button=${button}`, { method: "POST" });
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }
    async padReset(port) {
        const resp = await this.request(`/api/v1/pad?port=${port}&function=reset`, { method: "POST" });
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }
    async getPadState() {
        return this.getJson("/api/v1/pad");
    }
    // ── GPU / VRAM ──
    async getVram() {
        const resp = await this.request("/api/v1/gpu/vram/raw");
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }
    // ── Screenshot ──
    async getScreenshot() {
        const resp = await this.request("/api/v1/screen/still");
        if (!resp.ok)
            throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }
    // ── SPU capture ──
    async getSpuCaptureStatus() {
        return this.getJson("/api/v1/spu/capture/status");
    }
    async startSpuCapture(filepath) {
        // The web server reads 256 bytes at a time and takes each piece of a URL for a whole one.
        // fetch escapes more than encodeURIComponent, so the length is measured on the URL it sends.
        const path = `/api/v1/spu/capture/start?filepath=${encodeURIComponent(filepath)}`;
        const sent = new URL(path, this.baseUrl);
        const length = sent.pathname.length + sent.search.length;
        if (length > 250) {
            throw new Error(`The encoded request is ${length} bytes, the web server takes 250: use a shorter or a relative path.`);
        }
        const text = await this.postAction(path);
        return JSON.parse(text);
    }
    async stopSpuCapture() {
        const text = await this.postAction("/api/v1/spu/capture/stop");
        return JSON.parse(text);
    }
    // ── Lua ──
    async executeLua(handler, body) {
        const resp = await this.request(`/api/v1/lua/${handler}`, {
            method: body ? "POST" : "GET",
            body,
        });
        return resp.text();
    }
}
exports.PcsxClient = PcsxClient;
//# sourceMappingURL=pcsx-client.js.map
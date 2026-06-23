/***************************************************************************
 *   Copyright (C) 2020 PCSX-Redux authors                                 *
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 *   This program is distributed in the hope that it will be useful,       *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU General Public License for more details.                          *
 *                                                                         *
 *   You should have received a copy of the GNU General Public License     *
 *   along with this program; if not, write to the                         *
 *   Free Software Foundation, Inc.,                                       *
 *   51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.           *
 ***************************************************************************/

#include "core/web-server.h"

#include <llhttp.h>
#include <multipart_parser.h>

#include <charconv>
#include <magic_enum_all.hpp>
#include <map>
#include <memory>
#include <string>

#include "GL/gl3w.h"
#include "cdrom/cdriso.h"
#include "cdrom/file.h"
#include "cdrom/iso9660-reader.h"
#include "core/cdrom.h"
#include "core/debug.h"
#include "core/disr3000a.h"
#include "core/gpu.h"
#include "core/pad.h"
#include "core/psxemulator.h"
#include "core/psxmem.h"
#include "core/r3000a.h"
#include "core/system.h"
#include "gui/gui.h"
#include "lua/luawrapper.h"
#include "support/file.h"
#include "support/hashtable.h"
#include "support/strings-helpers.h"
#include "supportpsx/iso9660-builder.h"
#include "uriparser/Uri.h"

namespace {

class VramExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/gpu/vram/raw";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            client->write(
                "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 1048576\r\n\r\n");
            client->write(PCSX::g_emulator->m_gpu->getVRAM());

            return true;
        } else if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            auto vars = parseQuery(request.urlData.query);
            auto ix = vars.find("x");
            auto iy = vars.find("y");
            auto iwidth = vars.find("width");
            auto iheight = vars.find("height");
            if ((ix == vars.end()) || (iy == vars.end()) || (iwidth == vars.end()) || (iheight == vars.end()) ||
                (!ix->second.has_value()) || (!iy->second.has_value()) || (!iwidth->second.has_value()) ||
                (!iheight->second.has_value())) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            auto x = std::stoi(ix->second.value());
            auto y = std::stoi(iy->second.value());
            auto width = std::stoi(iwidth->second.value());
            auto height = std::stoi(iheight->second.value());
            if ((x < 0) || (y < 0) || (width < 0) || (height < 0)) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            if ((x > 1024) || (y > 512) || ((x + width) > 1024) || ((y + height) > 512)) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            auto size = width * height * sizeof(uint16_t);
            if (size != request.body.size()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }

            PCSX::g_emulator->m_gpu->partialUpdateVRAM(x, y, width, height, request.body.data<uint16_t>());
            client->write("HTTP/1.1 200 OK\r\n\r\n");
            return true;
        }
        return false;
    }

  public:
    VramExecutor() {}
    virtual ~VramExecutor() = default;
};

class RamExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/cpu/ram/raw";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        const auto& ram8M = PCSX::g_emulator->settings.get<PCSX::Emulator::Setting8MB>().value;
        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            if (ram8M) {
                client->write(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 8388608\r\n\r\n");
            } else {
                client->write(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 2097152\r\n\r\n");
            }
            uint32_t size = 1024 * 1024 * (ram8M ? 8 : 2);
            uint8_t* data = (uint8_t*)malloc(size);
            memcpy(data, PCSX::g_emulator->m_mem->m_wram, size);
            PCSX::Slice slice;
            slice.acquire(data, size);
            client->write(std::move(slice));
            return true;
        } else if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            const auto ramSize = (ram8M ? 8 : 2) * 1024 * 1024;
            auto vars = parseQuery(request.urlData.query);
            auto ioffset = vars.find("offset");
            auto isize = vars.find("size");
            if ((ioffset == vars.end()) || (isize == vars.end()) || (!isize->second.has_value()) ||
                (!ioffset->second.has_value())) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            auto offset = std::stoul(ioffset->second.value());
            auto size = std::stoul(isize->second.value());
            if ((offset >= ramSize) || (size > ramSize) || ((offset + size) > ramSize)) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            if (size != request.body.size()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }

            memcpy(PCSX::g_emulator->m_mem->m_wram + offset, request.body.data<uint8_t>(), size);
            client->write("HTTP/1.1 200 OK\r\n\r\n");
            return true;
        }
        return false;
    }

  public:
    RamExecutor() = default;
    virtual ~RamExecutor() = default;
};

class CpuRegistersExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/cpu/registers";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            auto& regs = PCSX::g_emulator->m_cpu->m_regs;
            nlohmann::json j;
            j["pc"] = regs.pc;
            j["code"] = regs.code;
            j["cycle"] = regs.cycle;

            nlohmann::json gpr;
            const char* gprNames[] = {
                "r0", "at", "v0", "v1", "a0", "a1", "a2", "a3",
                "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
                "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
                "t8", "t9", "k0", "k1", "gp", "sp", "s8", "ra",
                "lo", "hi"
            };
            for (int i = 0; i < 34; i++) {
                gpr[gprNames[i]] = regs.GPR.r[i];
            }
            j["gpr"] = gpr;

            nlohmann::json cp0;
            for (int i = 0; i < 32; i++) {
                cp0[PCSX::Disasm::s_disRNameCP0[i]] = regs.CP0.r[i];
            }
            j["cp0"] = cp0;

            nlohmann::json cp2d;
            for (int i = 0; i < 32; i++) {
                cp2d[PCSX::Disasm::s_disRNameCP2D[i]] = regs.CP2D.r[i];
            }
            j["cp2d"] = cp2d;

            nlohmann::json cp2c;
            for (int i = 0; i < 32; i++) {
                cp2c[PCSX::Disasm::s_disRNameCP2C[i]] = regs.CP2C.r[i];
            }
            j["cp2c"] = cp2c;

            write200(client, j);
            return true;
        }
        return false;
    }

  public:
    CpuRegistersExecutor() = default;
    virtual ~CpuRegistersExecutor() = default;
};

class PartialRamExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/cpu/ram";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        const auto& ram8M = PCSX::g_emulator->settings.get<PCSX::Emulator::Setting8MB>().value;
        const uint32_t ramSize = (ram8M ? 8 : 2) * 1024 * 1024;

        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            auto vars = parseQuery(request.urlData.query);
            auto iaddr = vars.find("addr");
            auto isize = vars.find("size");
            if ((iaddr == vars.end()) || (isize == vars.end()) || !iaddr->second.has_value() ||
                !isize->second.has_value()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing addr or size parameter.");
                return true;
            }
            uint32_t addr = 0;
            uint32_t size = 0;
            try {
                auto addrStr = iaddr->second.value();
                if (addrStr.substr(0, 2) == "0x" || addrStr.substr(0, 2) == "0X") {
                    addr = std::stoul(addrStr, nullptr, 16);
                } else {
                    addr = std::stoul(addrStr);
                }
                size = std::stoul(isize->second.value());
            } catch (...) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nInvalid addr or size.");
                return true;
            }
            if (size == 0 || size > 65536) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nSize must be 1-65536.");
                return true;
            }
            // Normalize PSX address to RAM offset (strip mirror bits)
            uint32_t offset = addr & (ramSize - 1);
            if (offset + size > ramSize) {
                client->write("HTTP/1.1 416 Range Not Satisfiable\r\n\r\nAddress range exceeds RAM.");
                return true;
            }
            uint8_t* data = (uint8_t*)malloc(size);
            memcpy(data, PCSX::g_emulator->m_mem->m_wram + offset, size);
            PCSX::Slice slice;
            slice.acquire(data, size);
            client->write(std::string("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ") +
                          std::to_string(size) + std::string("\r\n\r\n"));
            client->write(std::move(slice));
            return true;
        }
        return false;
    }

  public:
    PartialRamExecutor() = default;
    virtual ~PartialRamExecutor() = default;
};

class DisassembleExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/cpu/disassemble";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            auto vars = parseQuery(request.urlData.query);
            auto iaddr = vars.find("addr");
            auto icount = vars.find("count");
            if ((iaddr == vars.end()) || !iaddr->second.has_value()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing addr parameter.");
                return true;
            }
            uint32_t addr = 0;
            uint32_t count = 20;
            try {
                auto addrStr = iaddr->second.value();
                if (addrStr.substr(0, 2) == "0x" || addrStr.substr(0, 2) == "0X") {
                    addr = std::stoul(addrStr, nullptr, 16);
                } else {
                    addr = std::stoul(addrStr);
                }
                if (icount != vars.end() && icount->second.has_value()) {
                    count = std::stoul(icount->second.value());
                }
            } catch (...) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nInvalid addr or count.");
                return true;
            }
            if (count == 0 || count > 200) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nCount must be 1-200.");
                return true;
            }

            const auto& ram8M = PCSX::g_emulator->settings.get<PCSX::Emulator::Setting8MB>().value;
            const uint32_t ramSize = (ram8M ? 8 : 2) * 1024 * 1024;
            auto& cpu = PCSX::g_emulator->m_cpu;

            nlohmann::json instructions = nlohmann::json::array();
            for (uint32_t i = 0; i < count; i++) {
                uint32_t pc = addr + i * 4;
                uint32_t physAddr = pc & (ramSize - 1);
                uint32_t opcode = 0;
                // Try to read from RAM
                if ((pc & 0x1f000000) == 0x1f000000 || physAddr >= ramSize) {
                    // BIOS or out of range - try read32
                    opcode = PCSX::g_emulator->m_mem->read32(pc, PCSX::Memory::ReadType::Data);
                } else {
                    memcpy(&opcode, PCSX::g_emulator->m_mem->m_wram + physAddr, 4);
                }
                uint32_t nextOpcode = 0;
                if (i + 1 < count) {
                    uint32_t nextPc = pc + 4;
                    uint32_t nextPhysAddr = nextPc & (ramSize - 1);
                    if ((nextPc & 0x1f000000) == 0x1f000000 || nextPhysAddr >= ramSize) {
                        nextOpcode = PCSX::g_emulator->m_mem->read32(nextPc, PCSX::Memory::ReadType::Data);
                    } else {
                        memcpy(&nextOpcode, PCSX::g_emulator->m_mem->m_wram + nextPhysAddr, 4);
                    }
                }

                std::string disasm = PCSX::Disasm::asString(opcode, nextOpcode, pc, nullptr, false);
                nlohmann::json instr;
                instr["address"] = pc;
                instr["addressHex"] = fmt::format("0x{:08x}", pc);
                instr["opcode"] = opcode;
                instr["opcodeHex"] = fmt::format("0x{:08x}", opcode);
                instr["disassembly"] = disasm;

                auto sym = cpu->getSymbolAt(pc);
                if (sym) instr["symbol"] = *sym;

                instructions.push_back(instr);
            }

            nlohmann::json j;
            j["instructions"] = instructions;
            write200(client, j);
            return true;
        }
        return false;
    }

  public:
    DisassembleExecutor() = default;
    virtual ~DisassembleExecutor() = default;
};

class BreakpointsExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/cpu/breakpoints";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        auto& debug = *PCSX::g_emulator->m_debug;

        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            nlohmann::json bps = nlohmann::json::array();
            auto& tree = debug.getTree();
            for (auto& bp : tree) {
                nlohmann::json bpj;
                uint32_t fullAddr = bp.address() | bp.base();
                bpj["address"] = fullAddr;
                bpj["addressHex"] = fmt::format("0x{:08x}", fullAddr);
                bpj["type"] = bp.type() == PCSX::Debug::BreakpointType::Exec
                                  ? "Exec"
                                  : (bp.type() == PCSX::Debug::BreakpointType::Read ? "Read" : "Write");
                bpj["width"] = bp.width();
                bpj["label"] = bp.label();
                bpj["enabled"] = bp.enabled();
                bpj["source"] = bp.source();
                bps.push_back(bpj);
            }

            nlohmann::json j;
            j["breakpoints"] = bps;
            write200(client, j);
            return true;
        } else if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            auto vars = parseQuery(request.urlData.query);
            auto ifunction = vars.find("function");
            if (ifunction == vars.end() || !ifunction->second.has_value()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing function parameter.");
                return true;
            }
            std::string function = ifunction->second.value();

            if (function == "add") {
                auto iaddr = vars.find("addr");
                auto itype = vars.find("type");
                if (iaddr == vars.end() || !iaddr->second.has_value() || itype == vars.end() ||
                    !itype->second.has_value()) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing addr or type.");
                    return true;
                }
                uint32_t addr = 0;
                try {
                    auto addrStr = iaddr->second.value();
                    if (addrStr.substr(0, 2) == "0x" || addrStr.substr(0, 2) == "0X") {
                        addr = std::stoul(addrStr, nullptr, 16);
                    } else {
                        addr = std::stoul(addrStr);
                    }
                } catch (...) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nInvalid addr.");
                    return true;
                }
                std::string typeStr = itype->second.value();
                PCSX::Debug::BreakpointType bpType;
                if (typeStr == "exec") {
                    bpType = PCSX::Debug::BreakpointType::Exec;
                } else if (typeStr == "read") {
                    bpType = PCSX::Debug::BreakpointType::Read;
                } else if (typeStr == "write") {
                    bpType = PCSX::Debug::BreakpointType::Write;
                } else {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nInvalid type. Use exec, read, or write.");
                    return true;
                }
                unsigned width = 4;
                auto iwidth = vars.find("width");
                if (iwidth != vars.end() && iwidth->second.has_value()) {
                    try {
                        width = std::stoul(iwidth->second.value());
                    } catch (...) {
                    }
                }
                std::string label;
                auto ilabel = vars.find("label");
                if (ilabel != vars.end() && ilabel->second.has_value()) {
                    label = ilabel->second.value();
                }
                debug.addBreakpoint(addr, bpType, width, "web-api", label);
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            } else if (function == "remove") {
                auto iaddr = vars.find("addr");
                auto itype = vars.find("type");
                if (iaddr == vars.end() || !iaddr->second.has_value()) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing addr.");
                    return true;
                }
                uint32_t addr = 0;
                try {
                    auto addrStr = iaddr->second.value();
                    if (addrStr.substr(0, 2) == "0x" || addrStr.substr(0, 2) == "0X") {
                        addr = std::stoul(addrStr, nullptr, 16);
                    } else {
                        addr = std::stoul(addrStr);
                    }
                } catch (...) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nInvalid addr.");
                    return true;
                }
                PCSX::Debug::BreakpointType bpType = PCSX::Debug::BreakpointType::Exec;
                if (itype != vars.end() && itype->second.has_value()) {
                    std::string typeStr = itype->second.value();
                    if (typeStr == "read") bpType = PCSX::Debug::BreakpointType::Read;
                    else if (typeStr == "write")
                        bpType = PCSX::Debug::BreakpointType::Write;
                }
                uint32_t normalizedAddr = addr & ~0xe0000000;
                bool found = false;
                auto& tree = debug.getTree();
                const PCSX::Debug::Breakpoint* toRemove = nullptr;
                for (auto& bp : tree) {
                    if (bp.address() == normalizedAddr && bp.type() == bpType) {
                        toRemove = &bp;
                        break;
                    }
                }
                if (toRemove) {
                    debug.removeBreakpoint(toRemove);
                    found = true;
                }
                if (found) {
                    client->write("HTTP/1.1 200 OK\r\n\r\n");
                } else {
                    client->write("HTTP/1.1 404 Not Found\r\n\r\nBreakpoint not found.");
                }
                return true;
            } else if (function == "enable" || function == "disable") {
                auto iaddr = vars.find("addr");
                if (iaddr == vars.end() || !iaddr->second.has_value()) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing addr.");
                    return true;
                }
                uint32_t addr = 0;
                try {
                    auto addrStr = iaddr->second.value();
                    if (addrStr.substr(0, 2) == "0x" || addrStr.substr(0, 2) == "0X") {
                        addr = std::stoul(addrStr, nullptr, 16);
                    } else {
                        addr = std::stoul(addrStr);
                    }
                } catch (...) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nInvalid addr.");
                    return true;
                }
                uint32_t normalizedAddr = addr & ~0xe0000000;
                bool found = false;
                auto& tree = debug.getTree();
                for (auto& bp : tree) {
                    if (bp.address() == normalizedAddr) {
                        if (function == "enable")
                            bp.enable();
                        else
                            bp.disable();
                        found = true;
                    }
                }
                if (found) {
                    client->write("HTTP/1.1 200 OK\r\n\r\n");
                } else {
                    client->write("HTTP/1.1 404 Not Found\r\n\r\nBreakpoint not found.");
                }
                return true;
            } else if (function == "removeAll") {
                debug.removeAllBreakpoints();
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            client->write("HTTP/1.1 400 Bad Request\r\n\r\nUnknown function.");
            return true;
        }
        return false;
    }

  public:
    BreakpointsExecutor() = default;
    virtual ~BreakpointsExecutor() = default;
};

class PadExecutor : public PCSX::WebExecutor {
    static int buttonNameToIndex(std::string_view name) {
        static const std::pair<std::string_view, int> table[] = {
            {"select", 0}, {"start", 3},  {"up", 4},       {"right", 5},
            {"down", 6},   {"left", 7},   {"l2", 8},       {"r2", 9},
            {"l1", 10},    {"r1", 11},    {"triangle", 12}, {"circle", 13},
            {"cross", 14}, {"square", 15}
        };
        for (const auto& e : table) {
            if (e.first == name) return e.second;
        }
        return -1;
    }

    static nlohmann::json buildPortJson(PCSX::Pads::Port port) {
        uint16_t ov = PCSX::g_emulator->m_pads->getPadOverrides(port);
        nlohmann::json j;
        j["overrides_raw"] = ov;
        static const std::pair<std::string_view, int> table[] = {
            {"select", 0}, {"start", 3},  {"up", 4},       {"right", 5},
            {"down", 6},   {"left", 7},   {"l2", 8},       {"r2", 9},
            {"l1", 10},    {"r1", 11},    {"triangle", 12}, {"circle", 13},
            {"cross", 14}, {"square", 15}
        };
        for (const auto& e : table) {
            // bit=0 in overrides means button is forced pressed (PSX active-low)
            j["pressed"][std::string(e.first)] = ((ov >> e.second) & 1) == 0;
        }
        return j;
    }

    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/pad";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            nlohmann::json resp;
            resp["port1"] = buildPortJson(PCSX::Pads::Port::Port1);
            resp["port2"] = buildPortJson(PCSX::Pads::Port::Port2);
            write200(client, resp);
            return true;
        }
        if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            auto vars = parseQuery(request.urlData.query);
            auto ifunc = vars.find("function");
            if (ifunc == vars.end() || !ifunc->second.has_value()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing 'function' parameter. Valid: press, release, reset");
                return true;
            }
            const std::string func = ifunc->second.value();

            PCSX::Pads::Port port = PCSX::Pads::Port::Port1;
            auto iport = vars.find("port");
            if (iport != vars.end() && iport->second.has_value()) {
                if (iport->second.value() == "2") port = PCSX::Pads::Port::Port2;
            }

            auto& pads = *PCSX::g_emulator->m_pads;
            if (func == "reset") {
                pads.clearAllPadOverrides(port);
                client->write("HTTP/1.1 200 OK\r\n\r\nAll button overrides cleared.");
                return true;
            }

            auto ibtn = vars.find("button");
            if (ibtn == vars.end() || !ibtn->second.has_value()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\nMissing 'button' parameter.");
                return true;
            }
            int btnIdx = buttonNameToIndex(ibtn->second.value());
            if (btnIdx < 0) {
                client->write(fmt::format(
                    "HTTP/1.1 400 Bad Request\r\n\r\nUnknown button '{}'. Valid: select,start,up,right,down,left,l2,r2,l1,r1,triangle,circle,cross,square",
                    ibtn->second.value()));
                return true;
            }
            int portNum = (port == PCSX::Pads::Port::Port1) ? 1 : 2;
            if (func == "press") {
                pads.setPadButtonOverride(port, btnIdx);
                client->write(fmt::format("HTTP/1.1 200 OK\r\n\r\nButton '{}' pressed on port {}.",
                    ibtn->second.value(), portNum));
            } else if (func == "release") {
                pads.clearPadButtonOverride(port, btnIdx);
                client->write(fmt::format("HTTP/1.1 200 OK\r\n\r\nButton '{}' released on port {}.",
                    ibtn->second.value(), portNum));
            } else {
                client->write(fmt::format(
                    "HTTP/1.1 400 Bad Request\r\n\r\nUnknown function '{}'. Valid: press, release, reset", func));
            }
            return true;
        }
        return false;
    }

  public:
    PadExecutor() = default;
    virtual ~PadExecutor() = default;
};

class AssemblyExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/assembly/symbols";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            auto vars = parseQuery(request.urlData.query);
            auto ifunction = vars.find("function");
            if (ifunction == vars.end()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            std::string function = ifunction->second.value_or("");
            auto& cpu = PCSX::g_emulator->m_cpu;
            if (function.compare("reset") == 0) {
                cpu->m_symbols.clear();
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            if (function.compare("upload") == 0) {
                auto& body = request.body;
                PCSX::IO<PCSX::File> file = new PCSX::BufferFile(std::move(body));
                while (file && !file->failed() && !file->eof()) {
                    auto line = file->gets();
                    auto tokens = PCSX::StringsHelpers::split(std::string_view(line), " ");
                    if (tokens.size() != 2) {
                        continue;
                    }
                    auto addressStr = tokens[0];
                    auto name = tokens[1];
                    uint32_t address;
                    auto result =
                        std::from_chars(addressStr.data(), addressStr.data() + addressStr.size(), address, 16);
                    if (result.ec == std::errc::invalid_argument) continue;

                    cpu->m_symbols[address] = name;
                }
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
            return true;
        }
        return false;
    }

  public:
    AssemblyExecutor() = default;
    virtual ~AssemblyExecutor() = default;
};

class CacheExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/cpu/cache";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            auto vars = parseQuery(request.urlData.query);
            auto ifunction = vars.find("function");
            if (ifunction == vars.end()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            std::string function = ifunction->second.value_or("");
            if (function.compare("flush") == 0) {
                PCSX::g_emulator->m_cpu->invalidateCache();
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
            return true;
        }
        return false;
    }

  public:
    CacheExecutor() = default;
    virtual ~CacheExecutor() = default;
};

class FlowExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return urldata.path == "/api/v1/execution-flow";
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            auto& debugSettings = PCSX::g_emulator->settings.get<PCSX::Emulator::SettingDebugSettings>();

            nlohmann::json j;
            j["running"] = PCSX::g_system->running();
            j["isDynarec"] = PCSX::g_emulator->m_cpu->isDynarec();
            j["8mb"] = PCSX::g_emulator->settings.get<PCSX::Emulator::Setting8MB>().value;
            j["debugger"] = debugSettings.get<PCSX::Emulator::DebugSettings::Debug>().value;
            write200(client, j);
            return true;
        } else if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            auto vars = parseQuery(request.urlData.query);
            auto ifunction = vars.find("function");
            if (ifunction == vars.end()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            std::string function = ifunction->second.value_or("");
            if (function.compare("start") == 0) {
                PCSX::g_system->resume();
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            if (function.compare("pause") == 0) {
                PCSX::g_system->pause();
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            if (function.compare("resume") == 0) {
                PCSX::g_system->resume();
                client->write("HTTP/1.1 200 OK\r\n\r\n");
                return true;
            }
            /* Start of functions that requires a type */
            auto itype = vars.find("type");
            if (itype == vars.end()) {
                client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                return true;
            }
            std::string type = itype->second.value_or("");
            if (function.compare("reset") == 0) {
                if (type.compare("hard") == 0) {
                    PCSX::g_system->hardReset();
                    client->write("HTTP/1.1 200 OK\r\n\r\n");
                    return true;
                }
                if (type.compare("soft") == 0) {
                    PCSX::g_system->softReset();
                    client->write("HTTP/1.1 200 OK\r\n\r\n");
                    return true;
                }
            }
            client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
            return true;
        }
        return false;
    }

  public:
    FlowExecutor() = default;
    virtual ~FlowExecutor() = default;
};

class LuaExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return PCSX::StringsHelpers::startsWith(urldata.path, c_prefix);
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        auto L = *PCSX::g_emulator->m_lua;
        L.getfieldtable("PCSX", LUA_GLOBALSINDEX);
        L.getfieldtable("WebServer");
        L.getfieldtable("Handlers");
        L.getfield(request.urlData.path.substr(c_prefix.length()));
        auto x = L.type();
        if (L.isfunction()) {
            L.newtable();
            L.push("urlData");
            L.newtable();
            L.push("schema");
            L.push(request.urlData.schema);
            L.settable();
            L.push("host");
            L.push(request.urlData.host);
            L.settable();
            L.push("port");
            L.push(request.urlData.port);
            L.settable();
            L.push("path");
            L.push(request.urlData.path);
            L.settable();
            L.push("query");
            L.push(request.urlData.query);
            L.settable();
            L.push("fragment");
            L.push(request.urlData.fragment);
            L.settable();
            L.push("userInfo");
            L.push(request.urlData.userInfo);
            L.settable();
            L.settable();
            L.push("method");
            L.push(magic_enum::enum_name(request.method).substr(5));
            L.settable();
            L.push("headers");
            L.newtable();
            for (auto& header : request.headers) {
                L.getfieldtable(header.first);
                L.push(lua_Number(L.length() + 1));
                L.push(header.second);
                L.settable();
                L.pop();
            }
            L.settable();
            L.push("form");
            L.newtable();
            for (auto& variable : request.form) {
                L.getfieldtable(variable.first);
                L.push(lua_Number(L.length() + 1));
                L.push(variable.second);
                L.settable();
                L.pop();
            }
            L.settable();
            try {
                L.pcall(1);
                if (L.isstring()) {
                    auto response = L.tostring();
                    if (PCSX::StringsHelpers::startsWith(response, "HTTP/")) {
                        client->write(std::move(response));
                    } else {
                        std::string message = std::string(
                                                  "HTTP/1.1 200 OK\r\n"
                                                  "Content-Length: ") +
                                              std::to_string(response.size()) + std::string("\r\n\r\n") + response;
                        client->write(std::move(message));
                    }
                } else {
                    client->write(
                        "HTTP/1.1 500 Internal Server Error\r\n\r\nThe Lua script didn't return a string.\r\n");
                }
            } catch (std::exception& e) {
                std::string message = "HTTP/1.1 500 Internal Server Error\r\n\r\n";
                message += e.what();
                message += "\r\n";
                client->write(std::move(message));
            } catch (...) {
                client->write(
                    "HTTP/1.1 500 Internal Server Error\r\n\r\nAn unknown error occured while running Lua code.\r\n");
            }
        } else {
            client->write("HTTP/1.1 404 Not Found\r\n\r\nURL Not found.\r\n");
        }

        while (L.gettop()) L.pop();

        return true;
    }

  public:
    const std::string_view c_prefix = "/api/v1/lua/";
    LuaExecutor() = default;
    virtual ~LuaExecutor() = default;
};

class CDExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return PCSX::StringsHelpers::startsWith(urldata.path, c_prefix);
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        auto path = request.urlData.path.substr(c_prefix.length());
        auto& cdrom = PCSX::g_emulator->m_cdrom;
        auto iso = cdrom->getIso();
        PCSX::ISO9660Reader reader(iso);

        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            if (path == "info") {
                nlohmann::json j;
                j["id"] = cdrom->getCDRomID();
                j["label"] = cdrom->getCDRomLabel();
                j["iso"]["TN"] = iso->getTN();
                for (unsigned t = 0; t <= iso->getTN(); t++) {
                    if (t != 0) {
                        j["iso"]["tracktype"][t] = magic_enum::enum_name(iso->getTrackType(t));
                    }
                    auto duration = iso->getTD(t);
                    j["iso"]["TD"][t]["m"] = duration.m;
                    j["iso"]["TD"][t]["s"] = duration.s;
                    j["iso"]["TD"][t]["f"] = duration.f;
                }
                write200(client, j);
                return true;
            } else if (path == "files") {
                auto vars = parseQuery(request.urlData.query);
                auto filename = vars.find("filename");
                if (filename == vars.end()) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                PCSX::IO<PCSX::File> file = reader.open(filename->second.value_or(""));
                if (file->failed()) {
                    std::string message = fmt::format(
                        "HTTP/1.1 404 File Not Found\r\n\r\nFile `{}` was not found in the currently loaded disc "
                        "image.",
                        filename->second.value_or(""));
                    client->write(std::move(message));
                    return true;
                }
                auto size = file->size();
                client->write(std::string("HTTP/1.1 200 OK\r\n"
                                          "Content-Type: application/octet-stream\r\n"
                                          "Content-Length: ") +
                              std::to_string(size) + std::string("\r\n\r\n"));
                auto buffer = file->read(size);
                client->write(std::move(buffer));
                return true;
            }
            return false;
        } else if (request.method == PCSX::RequestData::Method::HTTP_POST) {
            if (path == "patch") {
                auto vars = parseQuery(request.urlData.query);
                auto filename = vars.find("filename");
                auto sector = vars.find("sector");
                auto modeStr = vars.find("mode");
                PCSX::IEC60908b::SectorMode mode = PCSX::IEC60908b::SectorMode::GUESS;
                if ((filename == vars.end()) && (sector == vars.end())) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                if ((filename != vars.end()) && (sector != vars.end())) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                if (modeStr != vars.end()) {
                    auto modeCast = magic_enum::enum_cast<PCSX::IEC60908b::SectorMode>(modeStr->second.value_or(""));
                    if (modeCast.has_value()) {
                        mode = modeCast.value();
                    } else {
                        client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                        return true;
                    }
                }

                if (reader.failed()) {
                    client->write("HTTP/1.1 404 File Not Found\r\n\r\nNo disc image currently loaded.");
                    return true;
                }

                PCSX::IO<PCSX::File> file;

                if (filename != vars.end()) {
                    file = reader.open(filename->second.value_or(""));
                }

                if (sector != vars.end()) {
                    auto sectorNumber = std::stoul(sector->second.value_or(""));
                    file = new PCSX::CDRIsoFile(iso, sectorNumber, request.body.size(), mode);
                }

                if (file->failed()) {
                    std::string message = fmt::format(
                        "HTTP/1.1 404 File Not Found\r\n\r\nFile {} was not found in the currently loaded disc image.",
                        filename->second.value_or(""));
                    client->write(std::move(message));
                    return true;
                }

                file->write(request.body.data<uint8_t>(), request.body.size());
                client->write("HTTP/1.1 200 OK\r\n\r\nDisc image has been patched successfully.");
                return true;
            } else if (path == "ppf") {
                auto vars = parseQuery(request.urlData.query);
                auto function = vars.find("function");
                if (function == vars.end()) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                if (function->second == "save") {
                    iso->getPPF()->save(iso->getIsoPath());
                } else if (function->second == "clear") {
                    iso->getPPF()->clear();
                } else {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\nUnknown function.");
                    return true;
                }
                client->write("HTTP/1.1 200 OK\r\n\r\n");
            }
            return false;
        }
        return false;
    }

  public:
    const std::string_view c_prefix = "/api/v1/cd/";
    CDExecutor() = default;
    virtual ~CDExecutor() = default;
};

class StateExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return PCSX::StringsHelpers::startsWith(urldata.path, c_prefix);
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        if (PCSX::g_gui == nullptr) {
            client->write("HTTP/1.1 500 Internal Server Error\r\n\r\nSave states unavailable in CLI/no-UI mode.");
            return false;
        }
        auto path = request.urlData.path.substr(c_prefix.length());

        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            if (path == "usage") {
                nlohmann::json j;
                for (uint32_t i = 0; i < 10; ++i) {
                    j["slots"][i] = PCSX::g_gui->getSaveStateExists(i);
                }
                const auto& namedSaves = PCSX::g_gui->getNamedSaveStates();
                for (uint32_t i = 0; i < namedSaves.size(); ++i) {
                    const auto& filenamePair = namedSaves[i];
                    j["named"][i]["name"] = filenamePair.second;
                    j["named"][i]["filepath"] = filenamePair.first.string();
                }
                write200(client, j);
                return true;
            } else if (path == "load" || path == "save" || path == "delete") {
                auto vars = parseQuery(request.urlData.query);
                auto islot = vars.find("slot");
                auto iname = vars.find("name");
                if ((islot == vars.end()) && (iname == vars.end())) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                if ((islot != vars.end()) && (iname != vars.end())) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                if (islot != vars.end()) {
                    std::string message;
                    int slot = -1;
                    if (!islot->second.has_value()) {
                        message = "HTTP/1.1 400 Bad Request\r\n\r\nState slot value is empty.";
                    } else {
                        try {
                            slot = std::stoul(islot->second.value());
                        } catch (std::exception const& ex) {
                            message =
                                fmt::format("HTTP/1.1 400 Bad Request\r\n\r\nFailed to parse state slot value \"{}\".",
                                            islot->second.value());
                            client->write(std::move(message));
                            return true;
                        }
                    }
                    if (slot < 0 || slot >= 10) {
                        message =
                            fmt::format("HTTP/1.1 400 Bad Request\r\n\r\nState slot index {} out of range 0-9.", slot);
                    } else {
                        bool success = false;
                        if (path == "load") {
                            success = PCSX::g_gui->loadSaveStateSlot(slot);
                        } else if (path == "save") {
                            success = PCSX::g_gui->saveSaveStateSlot(slot);
                        } else if (path == "delete") {
                            success = PCSX::g_gui->deleteSaveStateSlot(slot);
                        }
                        if (success) {
                            message =
                                fmt::format("HTTP/1.1 200 OK\r\n\r\nState slot index {} {} successful.", slot, path);
                        } else {
                            message = fmt::format(
                                "HTTP/1.1 500 Internal Server Error\r\n\r\nState slot index {} {} failed.", slot, path);
                        }
                    }
                    client->write(std::move(message));
                    return true;
                } else if (iname != vars.end()) {
                    std::string message;
                    auto name = iname->second.value_or("");
                    if (name.empty()) {
                        message = "HTTP/1.1 400 Bad Request\r\n\r\nState name is empty.";
                    } else if (name.length() > PCSX::Widgets::NamedSaveStates::NAMED_SAVE_STATE_LENGTH_MAX) {
                        message = fmt::format(
                            "HTTP/1.1 400 Bad Request\r\n\r\nState name \"{}\" exceeds {} characters in length.", name,
                            PCSX::Widgets::NamedSaveStates::NAMED_SAVE_STATE_LENGTH_MAX);
                    } else {
                        for (char c : name) {
                            if (!PCSX::Widgets::NamedSaveStates::TextFilters::isValid(c)) {
                                message = fmt::format(
                                    "HTTP/1.1 400 Bad Request\r\n\r\nState name \"{}\" includes invalid character(s).",
                                    name);
                                break;
                            }
                        }
                    }
                    if (message.empty()) {
                        std::filesystem::path saveFilepath(PCSX::g_gui->buildSaveStateFilename(name));
                        bool success = false;
                        if (path == "load") {
                            success = PCSX::g_gui->loadSaveState(saveFilepath);
                        } else if (path == "save") {
                            success = PCSX::g_gui->saveSaveState(saveFilepath);
                        } else if (path == "delete") {
                            success = PCSX::g_gui->deleteSaveState(saveFilepath);
                        }
                        if (success) {
                            message =
                                fmt::format("HTTP/1.1 200 OK\r\n\r\nState slot name \"{}\" {} successful.", name, path);
                        } else {
                            message = fmt::format(
                                "HTTP/1.1 500 Internal Server Error\r\n\r\nState slot name \"{}\" {} failed.", name,
                                path);
                        }
                    }
                    client->write(std::move(message));
                    return true;
                }
            }
        }
        return false;
    }

  public:
    const std::string_view c_prefix = "/api/v1/state/";
    StateExecutor() = default;
    virtual ~StateExecutor() = default;
};

class ScreenExecutor : public PCSX::WebExecutor {
    virtual bool match(PCSX::WebClient* client, const PCSX::UrlData& urldata) final {
        return PCSX::StringsHelpers::startsWith(urldata.path, c_prefix);
    }
    virtual bool execute(PCSX::WebClient* client, PCSX::RequestData& request) final {
        auto path = request.urlData.path.substr(c_prefix.length());

        if (request.method == PCSX::RequestData::Method::HTTP_HTTP_GET) {
            if (path == "save") {
                auto vars = parseQuery(request.urlData.query);
                auto ifilepath = vars.find("filepath");
                if (ifilepath == vars.end()) {
                    client->write("HTTP/1.1 400 Bad Request\r\n\r\n");
                    return true;
                }
                std::string message;
                std::filesystem::path path = std::filesystem::path(ifilepath->second.value_or("").c_str());
                if (path.is_relative()) {
                    std::filesystem::path persistentDir = PCSX::g_system->getPersistentDir();
                    if (persistentDir.empty()) {
                        persistentDir = std::filesystem::current_path();
                    }
                    path = persistentDir / path;
                }
                auto screenshot = PCSX::g_emulator->m_gpu->takeScreenShot();
                clip::image img = convertScreenshotToImage(std::move(screenshot));
                bool success = writeImagePNG(path.string(), std::move(img));
                if (success) {
                    message =
                        fmt::format("HTTP/1.1 200 OK\r\n\r\nScreenshot saved successfully to \"{}\".", path.string());
                } else {
                    message =
                        fmt::format("HTTP/1.1 500 Internal Server Error\r\n\r\nFailed to save screenshot to \"{}\".",
                                    path.string());
                }
                client->write(std::move(message));
                return true;
            } else if (path == "still") {
                auto screenshot = PCSX::g_emulator->m_gpu->takeScreenShot();
                clip::image img = convertScreenshotToImage(std::move(screenshot));
                writeImagePNG(client, std::move(img));
                return true;
            }
        }
        return false;
    }
    clip::image convertScreenshotToImage(PCSX::GPU::ScreenShot&& screenshot) {
        clip::image_spec spec;
        spec.width = screenshot.width;
        spec.height = screenshot.height;
        if (screenshot.bpp == PCSX::GPU::ScreenShot::BPP_16) {
            spec.bits_per_pixel = 16;
            spec.bytes_per_row = screenshot.width * 2;
            spec.red_mask = 0x1f;  // 0x7c00;
            spec.green_mask = 0x3e0;
            spec.blue_mask = 0x7c00;  // 0x1f;
            spec.alpha_mask = 0;
            spec.red_shift = 0;  // 10;
            spec.green_shift = 5;
            spec.blue_shift = 10;  // 0;
            spec.alpha_shift = 0;
        } else {
            spec.bits_per_pixel = 24;
            spec.bytes_per_row = screenshot.width * 3;
            spec.red_mask = 0xff0000;
            spec.green_mask = 0xff00;
            spec.blue_mask = 0xff;
            spec.alpha_mask = 0;
            spec.red_shift = 16;
            spec.green_shift = 8;
            spec.blue_shift = 0;
            spec.alpha_shift = 0;
        }
        clip::image img(screenshot.data.data(), spec);
        return img.to_rgba8888();
    }
    bool writeImagePNG(std::string filename, clip::image&& img) { return img.export_to_png(filename); }
    bool writeImagePNG(PCSX::WebClient* client, clip::image&& img) {
        std::vector<uint8_t> pngData;
        bool success = img.export_to_png(pngData);
        if (!success) {
            client->write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            return false;
        }
        client->write(std::string("HTTP/1.1 200 OK\r\n"));
        client->write(std::string("Cache-Control: no-cache, must-revalidate\r\n"));
        client->write(std::string("Expires: Fri, 31 Dec 1999 23:59:59 GMT\r\n"));
        client->write(std::string("Content-Type: image/png\r\n"));
        client->write(std::string("Content-Length: " + std::to_string(pngData.size()) + "\r\n\r\n"));
        PCSX::Slice slice;
        slice.copy(pngData.data(), pngData.size());
        client->write(std::move(slice));
        return true;
    }

  public:
    const std::string_view c_prefix = "/api/v1/screen/";
    ScreenExecutor() = default;
    virtual ~ScreenExecutor() = default;
};

}  // namespace

std::multimap<std::string, std::optional<std::string>> PCSX::WebExecutor::parseQuery(std::string_view query) {
    UriQueryListA* queryList;
    int itemCount;
    std::multimap<std::string, std::optional<std::string>> ret;
    const char* queryStart = query.data();
    const char* queryEnd = query.data() + query.size();
    if (uriDissectQueryMallocA(&queryList, &itemCount, queryStart, queryEnd) == URI_SUCCESS) {
        auto item = queryList;
        for (int i = 0; i < itemCount; ++i) {
            ret.emplace(item->key, item->value ? std::optional<std::string>{item->value} : std::nullopt);
            item = item->next;
        }
        uriFreeQueryListA(queryList);
    }

    return ret;
}

void PCSX::WebExecutor::write200(PCSX::WebClient* client, const nlohmann::json& j) {
    std::string json = j.dump();
    std::string message = std::string(
                              "HTTP/1.1 200 OK\r\n"
                              "Content-Type: application/json\r\n"
                              "Content-Length: ") +
                          std::to_string(json.size()) + std::string("\r\n\r\n") + json;
    client->write(std::move(message));
}

PCSX::WebServer::WebServer() : m_listener(g_system->m_eventBus) {
    m_executors.push_back(new VramExecutor());
    m_executors.push_back(new RamExecutor());
    m_executors.push_back(new CpuRegistersExecutor());
    m_executors.push_back(new PartialRamExecutor());
    m_executors.push_back(new DisassembleExecutor());
    m_executors.push_back(new BreakpointsExecutor());
    m_executors.push_back(new PadExecutor());
    m_executors.push_back(new AssemblyExecutor());
    m_executors.push_back(new CacheExecutor());
    m_executors.push_back(new FlowExecutor());
    m_executors.push_back(new LuaExecutor());
    m_executors.push_back(new CDExecutor());
    m_executors.push_back(new StateExecutor());
    m_executors.push_back(new ScreenExecutor());
    m_listener.listen<Events::SettingsLoaded>([this](const auto& event) {
        auto& debugSettings = g_emulator->settings.get<Emulator::SettingDebugSettings>();
        if (debugSettings.get<Emulator::DebugSettings::WebServer>() && (m_serverStatus != SERVER_STARTED)) {
            startServer(g_system->getLoop(), debugSettings.get<Emulator::DebugSettings::WebServerPort>());
        }
    });
    m_listener.listen<Events::Quitting>([this](const auto& event) {
        if (m_serverStatus == SERVER_STARTED) stopServer();
    });
}

void PCSX::WebServer::stopServer() {
    assert(m_serverStatus == SERVER_STARTED);
    m_serverStatus = SERVER_STOPPING;
    for (auto& client : m_clients) client.close();
    uv_close(reinterpret_cast<uv_handle_t*>(&m_server), closeCB);
}

void PCSX::WebServer::startServer(uv_loop_t* loop, int port) {
    assert(m_serverStatus == SERVER_STOPPED);
    m_loop = loop;
    uv_tcp_init(loop, &m_server);
    m_server.data = this;

    struct sockaddr_in bindAddr;
    int result = uv_ip4_addr("0.0.0.0", port, &bindAddr);
    if (result != 0) {
        uv_close(reinterpret_cast<uv_handle_t*>(&m_server), closeCB);
        return;
    }
    result = uv_tcp_bind(&m_server, reinterpret_cast<const sockaddr*>(&bindAddr), 0);
    if (result != 0) {
        uv_close(reinterpret_cast<uv_handle_t*>(&m_server), closeCB);
        return;
    }
    result = uv_listen((uv_stream_t*)&m_server, 16, [](uv_stream_t* handle, int status) {
        WebServer* self = static_cast<WebServer*>(handle->data);
        self->onNewConnection(status);
    });
    if (result != 0) {
        uv_close(reinterpret_cast<uv_handle_t*>(&m_server), closeCB);
        return;
    }
    m_serverStatus = SERVER_STARTED;
}

void PCSX::WebServer::closeCB(uv_handle_t* handle) {
    WebServer* self = static_cast<WebServer*>(handle->data);
    self->m_serverStatus = SERVER_STOPPED;
}

struct PCSX::WebClient::WebClientImpl {
    struct WriteRequest : public Intrusive::HashTable<uintptr_t, WriteRequest>::Node {
        WriteRequest() {}
        WriteRequest(Slice&& slice) : m_slice(std::move(slice)) {}
        void enqueue(WebClientImpl* client) {
            if (client->m_closeScheduled) {
                delete this;
                return;
            }
            m_buf.base = static_cast<char*>(const_cast<void*>(m_slice.data()));
            m_buf.len = m_slice.size();
            client->m_requests.insert(reinterpret_cast<uintptr_t>(&m_req), this);
            uv_write(&m_req, reinterpret_cast<uv_stream_t*>(&client->m_tcp), &m_buf, 1, writeCB);
        }
        static void writeCB(uv_write_t* request, int status) {
            WebClientImpl* client = static_cast<WebClientImpl*>(request->handle->data);
            auto self = client->m_requests.find(reinterpret_cast<uintptr_t>(request));
            delete &*self;
            if ((status != 0) || (client->m_closeScheduled && (client->m_requests.size() == 0))) client->close();
        }
        uv_buf_t m_buf;
        uv_write_t m_req;
        Slice m_slice;
    };
    Intrusive::HashTable<uintptr_t, WriteRequest> m_requests;

    WebClientImpl(WebServer* server, WebClient* parent) : m_server(server), m_parent(parent) {
        uv_tcp_init(server->m_loop, &m_tcp);
        m_tcp.data = this;
        llhttp_settings_init(&m_httpParserSettings);
        m_httpParserSettings.on_message_begin = [](auto* parser) {
            return static_cast<WebClientImpl*>(parser->data)->onMessageBegin();
        };
        m_httpParserSettings.on_url = [](auto* parser, const char* data, size_t size) {
            Slice slice;
            slice.borrow(data, size);
            return static_cast<WebClientImpl*>(parser->data)->onUrl(slice);
        };
        m_httpParserSettings.on_status = [](auto* parser, const char* data, size_t size) {
            Slice slice;
            slice.borrow(data, size);
            return static_cast<WebClientImpl*>(parser->data)->onStatus(slice);
        };
        m_httpParserSettings.on_header_field = [](auto* parser, const char* data, size_t size) {
            Slice slice;
            slice.borrow(data, size);
            return static_cast<WebClientImpl*>(parser->data)->onHeaderField(slice);
        };
        m_httpParserSettings.on_header_value = [](auto* parser, const char* data, size_t size) {
            Slice slice;
            slice.borrow(data, size);
            return static_cast<WebClientImpl*>(parser->data)->onHeaderValue(slice);
        };
        m_httpParserSettings.on_headers_complete = [](auto* parser) {
            return static_cast<WebClientImpl*>(parser->data)->onHeadersComplete();
        };
        m_httpParserSettings.on_body = [](auto* parser, const char* data, size_t size) {
            Slice slice;
            slice.borrow(data, size);
            return static_cast<WebClientImpl*>(parser->data)->onBody(slice);
        };
        m_httpParserSettings.on_message_complete = [](auto* parser) {
            return static_cast<WebClientImpl*>(parser->data)->onMessageComplete();
        };
        m_httpParserSettings.on_chunk_header = [](auto* parser) {
            return static_cast<WebClientImpl*>(parser->data)->onChunkHeader();
        };
        m_httpParserSettings.on_chunk_complete = [](auto* parser) {
            return static_cast<WebClientImpl*>(parser->data)->onChunkComplete();
        };
        llhttp_init(&m_httpParser, HTTP_REQUEST, &m_httpParserSettings);
        m_httpParser.data = this;
    }
    void close() {
        if (m_status != OPEN) return;
        m_status = CLOSING;
        uv_close(reinterpret_cast<uv_handle_t*>(&m_tcp), closeCB);
    }
    bool accept(uv_tcp_t* srv) {
        assert(m_status == CLOSED);
        if (uv_accept(reinterpret_cast<uv_stream_t*>(srv), reinterpret_cast<uv_stream_t*>(&m_tcp)) == 0) {
            uv_read_start(
                reinterpret_cast<uv_stream_t*>(&m_tcp),
                [](uv_handle_t* handle, size_t suggestedSize, uv_buf_t* buf) {
                    WebClientImpl* client = static_cast<WebClientImpl*>(handle->data);
                    client->alloc(suggestedSize, buf);
                },
                [](uv_stream_t* stream, ssize_t nread, const uv_buf_t* buf) {
                    WebClientImpl* client = static_cast<WebClientImpl*>(stream->data);
                    client->read(nread, buf);
                });
            m_status = OPEN;
        }
        return m_status == OPEN;
    }

    void onEOF() {
        auto error = llhttp_finish(&m_httpParser);
        if (error == HPE_PAUSED_UPGRADE) {
            onUpgrade();
        } else if (error != HPE_OK) {
            send400(magic_enum::enum_name(error));
        } else {
            scheduleClose();
        }
    }

    void onUpgrade() {}
    int onMessageBegin() { return 0; }
    int onUrl(const Slice& slice) {
        UriUriA uri;
        std::string urlString = slice.asString();
        const char* errorPos;
        if (uriParseSingleUriA(&uri, urlString.c_str(), &errorPos) != URI_SUCCESS) return 1;
        m_requestData.urlData.schema = uri.scheme.first ? std::string(uri.scheme.first, uri.scheme.afterLast) : "";
        m_requestData.urlData.host = uri.hostText.first ? std::string(uri.hostText.first, uri.hostText.afterLast) : "";
        m_requestData.urlData.port = uri.portText.first ? std::string(uri.portText.first, uri.portText.afterLast) : "";
        std::string path;
        auto pathFragment = uri.pathHead;
        while (pathFragment) {
            path += '/' + std::string(pathFragment->text.first, pathFragment->text.afterLast);
            pathFragment = pathFragment->next;
        }
        m_requestData.urlData.path = std::move(path);
        m_requestData.urlData.query = uri.query.first ? std::string(uri.query.first, uri.query.afterLast) : "";
        m_requestData.urlData.fragment =
            uri.fragment.first ? std::string(uri.fragment.first, uri.fragment.afterLast) : "";
        m_requestData.urlData.userInfo =
            uri.userInfo.first ? std::string(uri.userInfo.first, uri.userInfo.afterLast) : "";
        uriFreeUriMembersA(&uri);
        g_system->log(LogClass::WEBSERVER, "Received web api request, path: %s, query: %s\n",
                      m_requestData.urlData.path.c_str(), m_requestData.urlData.query.c_str());
        return findExecutor() ? 0 : 1;
    }
    int onStatus(const Slice& slice) { return 0; }
    void headerComplete() {
        m_requestData.headers.insert(std::pair(m_currentHeader, m_currentValue));
        m_currentHeader.clear();
        m_currentValue.clear();
    }
    int onHeaderField(const Slice& slice) {
        if (m_headerState == PARSING_VALUE) {
            headerComplete();
            m_headerState = PARSING_HEADER;
        }
        m_currentHeader += slice.asString();
        return 0;
    }
    int onHeaderValue(const Slice& slice) {
        m_headerState = PARSING_VALUE;
        m_currentValue += slice.asString();
        return 0;
    }
    void formHeaderComplete() {
        m_requestData.form.insert(std::pair(m_currentFormHeader, m_currentFormValue));
        m_currentFormHeader.clear();
        m_currentFormValue.clear();
    }
    int onFormHeaderField(const Slice& slice) {
        if (m_formHeaderState == PARSING_VALUE) {
            formHeaderComplete();
            m_formHeaderState = PARSING_HEADER;
        }
        m_currentFormHeader += slice.asString();
        return 0;
    }
    int onFormHeaderValue(const Slice& slice) {
        m_formHeaderState = PARSING_VALUE;
        m_currentFormValue += slice.asString();
        return 0;
    }
    int onHeadersComplete() {
        headerComplete();
        auto& ct = m_requestData.headers;
        auto it = ct.find("Content-Type");
        if (it != ct.end()) {
            std::string_view contentType = it->second;
            if (contentType.starts_with("multipart/form-data")) {
                auto pos = contentType.find("boundary=");
                if (pos != std::string::npos) {
                    std::string_view marker = contentType.substr(pos + 9);
                    if (marker.starts_with("\"") && marker.ends_with("\"") && marker.size() >= 2) {
                        marker = marker.substr(1, marker.size() - 2);
                    }
                    m_multipartBoundary = std::string("--");
                    m_multipartBoundary += marker;
                    m_multipart = true;
                    memset(&m_multipartParserCallbacks, 0, sizeof(multipart_parser_settings));
                    m_multipartParserCallbacks.on_header_field = [](multipart_parser* p, const char* at,
                                                                    size_t length) {
                        Slice slice;
                        slice.borrow(at, length);
                        return static_cast<WebClientImpl*>(multipart_parser_get_data(p))->onFormHeaderField(slice);
                    };
                    m_multipartParserCallbacks.on_header_value = [](multipart_parser* p, const char* at,
                                                                    size_t length) {
                        Slice slice;
                        slice.borrow(at, length);
                        return static_cast<WebClientImpl*>(multipart_parser_get_data(p))->onFormHeaderValue(slice);
                    };
                    m_multipartParserCallbacks.on_headers_complete = [](multipart_parser* p) {
                        return static_cast<WebClientImpl*>(multipart_parser_get_data(p))->onFormHeadersComplete();
                    };
                    m_multipartParserCallbacks.on_part_data = [](multipart_parser* p, const char* at, size_t length) {
                        Slice slice;
                        slice.borrow(at, length);
                        return static_cast<WebClientImpl*>(multipart_parser_get_data(p))->onFormData(slice);
                    };
                    m_multipartParser = multipart_parser_init(m_multipartBoundary.c_str(), &m_multipartParserCallbacks);
                    multipart_parser_set_data(m_multipartParser, this);
                }
            }
        }
        return 0;
    }

    int onFormHeadersComplete() {
        formHeaderComplete();
        return 0;
    }

    int onFormData(const Slice& slice) {
        m_requestData.body.concatenate(slice);
        return 0;
    }

    int onBody(const Slice& slice) {
        if (m_multipart) {
            multipart_parser_execute(m_multipartParser, slice.data<char>(), slice.size());
        } else {
            m_requestData.body.concatenate(slice);
        }
        return 0;
    }
    int onMessageComplete() {
        if (m_multipart) {
            multipart_parser_free(m_multipartParser);
        }
        executeRequest();
        return 0;
    }
    int onChunkHeader() { return 0; }
    int onChunkComplete() { return 0; }
    void alloc(size_t suggestedSize, uv_buf_t* buf) {
        assert(!m_allocated);
        m_allocated = true;
        buf->base = m_buffer;
        buf->len = sizeof(m_buffer);
    }
    void read(ssize_t nread, const uv_buf_t* buf) {
        m_allocated = false;
        if (nread <= 0) {
            onEOF();
            return;
        }
        Slice slice;
        slice.borrow(m_buffer, nread);
        processData(slice);
    }
    static void closeCB(uv_handle_t* handle) {
        WebClientImpl* client = static_cast<WebClientImpl*>(handle->data);
        delete client->m_parent;
    }
    void processData(const Slice& slice) {
        const char* ptr = reinterpret_cast<const char*>(slice.data());
        auto size = slice.size();

        auto error = llhttp_execute(&m_httpParser, ptr, size);
        if (m_status != OPEN) return;
        if (error == HPE_PAUSED_UPGRADE) {
            onUpgrade();
        } else if (error != HPE_OK) {
            send400(magic_enum::enum_name(error));
        }
    }

    template <size_t L>
    void write(const char (&str)[L]) {
        static_assert((L - 1) <= std::numeric_limits<uint32_t>::max());
        Slice slice;
        slice.borrow(str, L - 1);
        write(std::move(slice));
    }

    void write(Slice&& slice) {
        auto* req = new WriteRequest(std::move(slice));
        req->enqueue(this);
    }

    void write(std::string&& str) {
        Slice slice(std::move(str));
        write(std::move(slice));
    }

    void write(const std::string& str) {
        Slice slice(str);
        write(std::move(slice));
    }

    void send400(std::string_view code) {
        std::string str =
            fmt::format("HTTP/1.1 400 Bad Request\r\n\r\nRequest failed to parse properly. Error: {}\r\n", code);
        write(std::move(str));
        scheduleClose();
    }

    void send404() {
        write("HTTP/1.1 404 Not Found\r\n\r\nURL Not found.\r\n");
        scheduleClose();
    }

    bool findExecutor() {
        auto& list = m_server->m_executors;
        for (m_currentExecutor = list.begin(); m_currentExecutor != list.end(); m_currentExecutor++) {
            if (m_currentExecutor->match(m_parent, m_requestData.urlData)) return true;
        }
        send404();
        return false;
    }
    int executeRequest() {
        m_requestData.method = static_cast<RequestData::Method>(m_httpParser.method);
        m_currentExecutor->execute(m_parent, m_requestData);
        scheduleClose();
        return 0;
    }
    void scheduleClose() {
        if (m_requests.size() == 0) {
            close();
        } else {
            m_closeScheduled = true;
        }
    }

    WebServer* m_server;
    uv_tcp_t m_tcp;
    static constexpr size_t BUFFER_SIZE = 256;
    char m_buffer[BUFFER_SIZE];
    bool m_allocated = false;
    enum { CLOSED, OPEN, CLOSING } m_status = CLOSED;
    llhttp_settings_t m_httpParserSettings;
    llhttp_t m_httpParser;
    Intrusive::List<WebExecutor>::iterator m_currentExecutor;
    WebClient* m_parent;

    std::string m_currentHeader;
    std::string m_currentValue;
    std::string m_currentFormHeader;
    std::string m_currentFormValue;
    enum HeaderState {
        PARSING_HEADER,
        PARSING_VALUE,
    };
    HeaderState m_headerState = PARSING_HEADER;
    HeaderState m_formHeaderState = PARSING_HEADER;
    RequestData m_requestData;
    bool m_multipart = false;
    std::string m_multipartBoundary;
    multipart_parser* m_multipartParser;
    multipart_parser_settings m_multipartParserCallbacks;

    bool m_closeScheduled = false;
};

PCSX::WebClient::WebClient(WebServer* server) : m_impl(std::make_unique<WebClientImpl>(server, this)) {}
void PCSX::WebClient::close() { m_impl->close(); }
bool PCSX::WebClient::accept(uv_tcp_t* srv) { return m_impl->accept(srv); }
void PCSX::WebClient::write(Slice&& slice) { m_impl->write(std::move(slice)); }
void PCSX::WebClient::write(std::string&& str) { m_impl->write(std::move(str)); }
void PCSX::WebClient::write(const std::string& str) { m_impl->write(str); }

void PCSX::WebServer::onNewConnection(int status) {
    if (status < 0) return;
    WebClient* client = new WebClient(this);
    if (client->accept(&m_server)) {
        m_clients.push_back(client);
    } else {
        delete client;
    }
}

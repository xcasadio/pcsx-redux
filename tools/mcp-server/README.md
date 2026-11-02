# PCSX-Redux MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects AI assistants (GitHub Copilot, Claude, etc.) to the [PCSX-Redux](https://github.com/grumpycoders/pcsx-redux) PlayStation 1 emulator for AI-assisted debugging, reverse engineering, and game analysis.

## Architecture

```
VS Code (AI Agent)
      │
      ▼  MCP Protocol (stdio)
  mcp-server (Node.js)
      │
      ▼  HTTP REST
  PCSX-Redux Web API (:8080)
      │
      ├── CPU registers, memory, disassembly
      ├── Breakpoints, execution control
      ├── CD-ROM filesystem access
      ├── Save states, VRAM, screenshots
      ├── SPU capture to WAV
      └── Symbol management
```

## Prerequisites

1. **PCSX-Redux** with the Web Server enabled (Settings → Debug → Web Server, default port 8080)
2. **Node.js** >= 18
3. **VS Code** with GitHub Copilot or another MCP-compatible AI

## Installation

```bash
cd tools/mcp-server
npm install
npm run build
```

## Configuration

The MCP configuration is already in `.vscode/mcp.json`:

```json
{
  "servers": {
    "pcsx-redux": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/tools/mcp-server/dist/index.js"],
      "env": {
        "PCSX_HOST": "localhost",
        "PCSX_PORT": "8080"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PCSX_HOST` | `localhost` | PCSX-Redux web server host |
| `PCSX_PORT` | `8080` | PCSX-Redux web server port |
| `PCSX_TIMEOUT` | `10000` | HTTP request timeout (ms) |

## Available Tools

### Execution Control
| Tool | Description |
|---|---|
| `pcsx_get_status` | Get emulator state (running/paused, dynarec, RAM size) |
| `pcsx_pause` | Pause emulation |
| `pcsx_resume` | Resume emulation |
| `pcsx_reset` | Hard or soft reset |
| `pcsx_flush_cache` | Flush CPU instruction cache |

### CPU Registers & Disassembly
| Tool | Description |
|---|---|
| `pcsx_get_registers` | Read all MIPS R3000A registers (GPR, CP0, CP2, PC) |
| `pcsx_get_pc` | Get current Program Counter |
| `pcsx_disassemble` | Disassemble N instructions at an address |
| `pcsx_analyze_function` | Disassemble until `jr $ra` and annotate |

### Memory
| Tool | Description |
|---|---|
| `pcsx_read_memory` | Read bytes as hex dump with ASCII |
| `pcsx_read_memory_raw` | Read bytes as base64 |
| `pcsx_write_memory` | Write hex bytes to RAM |
| `pcsx_search_memory` | Search for byte pattern in RAM |
| `pcsx_read_word` | Read a 32-bit word |
| `pcsx_read_string` | Read a null-terminated ASCII string |

### Breakpoints
| Tool | Description |
|---|---|
| `pcsx_list_breakpoints` | List all breakpoints |
| `pcsx_add_breakpoint` | Add exec/read/write breakpoint |
| `pcsx_remove_breakpoint` | Remove a breakpoint |
| `pcsx_toggle_breakpoint` | Enable/disable a breakpoint |
| `pcsx_remove_all_breakpoints` | Clear all breakpoints |
| `pcsx_wait_for_break` | Poll until emulator pauses (breakpoint hit) |

### CD-ROM & Symbols
| Tool | Description |
|---|---|
| `pcsx_cdrom_info` | Get disc ID, label, tracks |
| `pcsx_cdrom_read_file` | Read a file from the ISO filesystem |
| `pcsx_upload_symbols` | Upload address→name symbol map |
| `pcsx_reset_symbols` | Clear all symbols |

### Save States & GPU
| Tool | Description |
|---|---|
| `pcsx_savestate_list` | List save state slots |
| `pcsx_savestate_save` | Save state to slot or by name |
| `pcsx_savestate_load` | Load state from slot or by name |
| `pcsx_get_vram` | Dump GPU VRAM (1MB raw) |
| `pcsx_screenshot` | Take a PNG screenshot |

### SPU Capture
| Tool | Description |
|---|---|
| `pcsx_spu_capture_start` | Start writing the SPU mix to a WAV file |
| `pcsx_spu_capture_stop` | Stop the capture and finish the file |
| `pcsx_spu_capture_status` | Report the running or last capture |

## Example Session

Here's how an AI assistant might analyze Parasite Eve:

```
User: What game is loaded?

AI: [calls pcsx_cdrom_info]
→ Game ID: SLUS-00662, Label: "PARASITE EVE"

User: Read the first 20 instructions at the entry point 0x80010000

AI: [calls pcsx_disassemble("0x80010000", 20)]
→ Shows MIPS assembly listing with symbols

User: Search for the string "GAME OVER" in memory

AI: [calls pcsx_search_memory("47414d45204f564552")]
→ Found at 0x800F4320

User: Set a breakpoint at 0x80023400 and run until it hits

AI: [calls pcsx_add_breakpoint("0x80023400", "exec", 4, "MainLoop")]
    [calls pcsx_resume]
    [calls pcsx_wait_for_break(10000)]
→ Paused at PC=0x80023400 (cycle 1234567)

User: Show me the registers

AI: [calls pcsx_get_registers]
→ PC: 0x80023400  a0: 0x80100000  sp: 0x801FFF00 ...

User: What function is at a0?

AI: [calls pcsx_disassemble("0x80100000", 50)]
    [calls pcsx_analyze_function("0x80100000")]
→ Analyzes the function prologue, stack frame, and called functions
```

## Development

```bash
npm run dev    # Watch mode (recompiles on changes)
npm run build  # Production build
npm start      # Run the server
```

## License

MIT — see [LICENSE](../../LICENSE)

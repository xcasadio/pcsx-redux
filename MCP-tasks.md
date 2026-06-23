# PCSX-Redux MCP Server — AI Agent Task List

> Objectif : Permettre à un agent IA (GitHub Copilot / Claude) dans VS Code de se connecter à PCSX-Redux
> pour déboguer, analyser la mémoire et décompiler un jeu PSX (ex : Parasite Eve).
>
> Convention : **commit après chaque tâche** avec le message indiqué.
> Chaque tâche est indépendante et testable séparément.

---

## Vue d'ensemble de l'architecture

```
VS Code (Agent IA)
      │
      ▼  MCP Protocol (stdio/SSE)
 tools/mcp-server/          ← Nouveau projet Node.js/TypeScript
      │
      ├── HTTP REST  ──────► PCSX-Redux Web API  (port 8080)
      │                        /api/v1/cpu/ram/raw
      │                        /api/v1/cpu/registers      (à créer)
      │                        /api/v1/cpu/disassemble    (à créer)
      │                        /api/v1/cpu/breakpoints    (à créer)
      │                        /api/v1/cpu/ram            (à créer)
      │                        /api/v1/execution-flow
      │                        /api/v1/gpu/vram/raw
      │                        /api/v1/cd/files
      │                        /api/v1/savestate          (à créer)
      │
      └── GDB RSP    ──────► PCSX-Redux GDB Server (port 3333)
                               (breakpoints avancés, step)
```

---

## TÂCHE 1 — Endpoint HTTP : Registres CPU

**Fichier :** `src/core/web-server.cc`

**But :** Exposer les registres MIPS R3000A (GPR, CP0, CP2, PC) en JSON via HTTP.

**Spécifications :**

```
GET /api/v1/cpu/registers
```

Réponse JSON :
```json
{
  "pc": 2148532224,
  "gpr": {
    "r0": 0, "at": 0, "v0": 0, "v1": 0,
    "a0": 0, "a1": 0, "a2": 0, "a3": 0,
    "t0": 0, "t1": 0, "t2": 0, "t3": 0,
    "t4": 0, "t5": 0, "t6": 0, "t7": 0,
    "s0": 0, "s1": 0, "s2": 0, "s3": 0,
    "s4": 0, "s5": 0, "s6": 0, "s7": 0,
    "t8": 0, "t9": 0, "k0": 0, "k1": 0,
    "gp": 0, "sp": 0, "s8": 0, "ra": 0,
    "lo": 0, "hi": 0
  },
  "cp0": { "r0": 0, "..." : "..." },
  "cp2d": { "r0": 0, "..." : "..." },
  "cp2c": { "r0": 0, "..." : "..." },
  "cycles": 12345678
}
```

**Implementation hint :**
- Ajouter une classe `CpuRegistersExecutor` dans `web-server.cc` sur le modèle de `FlowExecutor`
- Inclure `core/r3000a.h` — struct `psxRegisters` avec `GPR.n.pc`, `GPR.r[]`, `CP0.r[]`, `CP2D.r[]`, `CP2C.r[]`
- Accès via `PCSX::g_emulator->m_cpu->m_psxRegs`
- Cycles via `PCSX::g_emulator->m_cpu->m_psxRegs.cycle`
- Enregistrer l'exécuteur dans `WebServer::WebServer()` comme les autres

**Commit :** `feat(web-server): add GET /api/v1/cpu/registers endpoint`

---

## TÂCHE 2 — Endpoint HTTP : Lecture RAM partielle

**Fichier :** `src/core/web-server.cc`

**But :** Lire un segment précis de la RAM sans tout télécharger (2MB/8MB).

**Spécifications :**

```
GET /api/v1/cpu/ram?addr=<hex_or_dec>&size=<bytes>
```

- `addr` : adresse PSX (ex: `0x80000000`, `0x00000000`, valeur décimale)
  - Normaliser : masquer avec `0x1fffff` (ou `0x7fffff` si 8MB) pour obtenir l'offset RAM
- `size` : nombre d'octets (max 65536 par requête)
- Réponse : `application/octet-stream` (binaire brut)

Réponse d'erreur :
- 400 si `addr` ou `size` manquants/invalides
- 416 si l'adresse est hors RAM

**Implementation hint :**
- Réutiliser la logique de `RamExecutor` pour la validation
- Normalisation d'adresse : `uint32_t offset = addr & (ramSize - 1)`
- Ne pas oublier les addresses miroir PSX (`0x80000000`, `0xA0000000`, `0x00000000` = même RAM physique)

**Commit :** `feat(web-server): add GET /api/v1/cpu/ram partial read endpoint`

---

## TÂCHE 3 — Endpoint HTTP : Désassemblage

**Fichier :** `src/core/web-server.cc`

**But :** Désassembler N instructions à partir d'une adresse PSX.

**Spécifications :**

```
GET /api/v1/cpu/disassemble?addr=<addr>&count=<n>
```

- `addr` : adresse PSX (hex ou décimal)
- `count` : nombre d'instructions (défaut : 20, max : 200)

Réponse JSON :
```json
{
  "instructions": [
    {
      "address": 2148532224,
      "addressHex": "0x80010000",
      "opcode": 0x27BDFFE0,
      "disassembly": "addiu $sp, $sp, -0x20",
      "symbol": "GameMain"
    },
    ...
  ]
}
```

**Implementation hint :**
- Utiliser `PCSX::Disasm::disassemble()` depuis `core/disr3000a.h`
- Lire les opcodes via `PCSX::g_emulator->m_mem->read32()` ou directement via la LUT
- Chercher les symboles dans `PCSX::g_emulator->m_cpu->m_symbols` (map<uint32_t, string>)
- Inclure `core/disr3000a.h` et `core/psxmem.h`

**Commit :** `feat(web-server): add GET /api/v1/cpu/disassemble endpoint`

---

## TÂCHE 4 — Endpoint HTTP : Breakpoints

**Fichier :** `src/core/web-server.cc`

**But :** Gérer les breakpoints via HTTP (liste, ajout, suppression).

**Spécifications :**

```
GET  /api/v1/cpu/breakpoints
POST /api/v1/cpu/breakpoints?function=add&addr=<addr>&type=exec|read|write&width=<n>&label=<str>
POST /api/v1/cpu/breakpoints?function=remove&addr=<addr>&type=exec|read|write
POST /api/v1/cpu/breakpoints?function=enable&addr=<addr>&type=exec|read|write
POST /api/v1/cpu/breakpoints?function=disable&addr=<addr>&type=exec|read|write
```

GET Réponse JSON :
```json
{
  "breakpoints": [
    {
      "address": 2148532224,
      "addressHex": "0x80010000",
      "type": "Exec",
      "width": 4,
      "label": "GameMain",
      "enabled": true,
      "source": "web-api"
    }
  ]
}
```

**Implementation hint :**
- Accès via `PCSX::g_emulator->m_debug` (instance de `Debug`)
- `debug.addBreakpoint(addr, type, width, "", invoker, label)` — l'invoker doit appeler `g_system->pause()`
- Pour lister : itérer sur `debug.m_bpExec`, `debug.m_bpRead`, `debug.m_bpWrite` (arbres `BreakpointTreeType`)
- Stocker les breakpoints créés via HTTP dans un `std::map` local au `BreakpointsExecutor` pour les retrouver par addr+type
- Inclure `core/debug.h`

**Commit :** `feat(web-server): add /api/v1/cpu/breakpoints CRUD endpoint`

---

## TÂCHE 5 — Endpoint HTTP : Save States

**Fichier :** `src/core/web-server.cc`

**But :** Créer et charger des save states via HTTP.

**Spécifications :**

```
GET  /api/v1/savestate                        → télécharger le save state (octet-stream)
POST /api/v1/savestate                        → charger un save state (corps = fichier save state)
POST /api/v1/savestate?function=create        → créer et retourner le save state
```

**Implementation hint :**
- Utiliser `PCSX::g_emulator->m_sstate->save()` → retourne un `PCSX::IO<PCSX::File>`
- Charger avec `PCSX::g_emulator->m_sstate->load(file)`
- File dans `core/sstate.h`

**Commit :** `feat(web-server): add /api/v1/savestate endpoint`

---

## TÂCHE 6 — Scaffolding du MCP Server

**Répertoire :** `tools/mcp-server/`

**But :** Créer un projet Node.js/TypeScript qui implémente le protocole MCP (Model Context Protocol)
pour exposer les fonctionnalités PCSX-Redux comme outils IA.

**Structure à créer :**

```
tools/mcp-server/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts          ← point d'entrée MCP server (stdio transport)
│   ├── pcsx-client.ts    ← client HTTP pour l'API PCSX-Redux
│   ├── tools/
│   │   ├── memory.ts     ← outils lecture/écriture mémoire
│   │   ├── execution.ts  ← outils contrôle d'exécution
│   │   ├── debug.ts      ← outils breakpoints et registres
│   │   ├── disassembly.ts← outils désassemblage
│   │   └── cdrom.ts      ← outils accès ISO/CD-ROM
│   └── types.ts          ← types partagés
```

**Dépendances :**
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "axios": "^1.6.0"
}
```

**Transport :** `StdioServerTransport` (pour fonctionner avec VS Code Copilot MCP config)

**Configuration VS Code** à créer dans `.vscode/mcp.json` :
```json
{
  "servers": {
    "pcsx-redux": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/tools/mcp-server/dist/index.js"],
      "env": {
        "PCSX_HOST": "localhost",
        "PCSX_PORT": "8080",
        "PCSX_GDB_PORT": "3333"
      }
    }
  }
}
```

**Commit :** `feat(mcp-server): scaffold MCP server project structure`

---

## TÂCHE 7 — MCP Tools : Contrôle d'exécution

**Fichier :** `tools/mcp-server/src/tools/execution.ts`

**But :** Implémenter les outils MCP de contrôle de l'émulateur.

**Outils à exposer :**

| Tool MCP | Description | Paramètres |
|---|---|---|
| `pcsx_get_status` | État de l'émulateur | aucun |
| `pcsx_pause` | Pause l'émulation | aucun |
| `pcsx_resume` | Reprend l'émulation | aucun |
| `pcsx_reset` | Reset hard ou soft | `type: "hard" \| "soft"` |

**Spécification outil `pcsx_get_status` :**
```typescript
{
  name: "pcsx_get_status",
  description: "Get the current state of the PCSX-Redux emulator",
  inputSchema: { type: "object", properties: {} },
  // Returns: { running, isDynarec, is8mb, debugger }
}
```

**Commit :** `feat(mcp-server): add execution control MCP tools`

---

## TÂCHE 8 — MCP Tools : Lecture mémoire

**Fichier :** `tools/mcp-server/src/tools/memory.ts`

**But :** Permettre à l'IA de lire et analyser la mémoire PSX.

**Outils à exposer :**

| Tool MCP | Description | Paramètres |
|---|---|---|
| `pcsx_read_memory` | Lire N octets à une adresse | `address: string (hex), size: number` |
| `pcsx_read_memory_hex` | Lire mémoire et retourner en hexdump lisible | `address: string, size: number, width: 1\|2\|4` |
| `pcsx_dump_ram` | Dump RAM complète (base64) | aucun |
| `pcsx_write_memory` | Écrire des octets en RAM | `address: string, data: string (hex)` |
| `pcsx_search_memory` | Chercher une séquence d'octets | `pattern: string (hex), offset?: string` |

**Format hexdump pour `pcsx_read_memory_hex` :**
```
80010000: 27 BD FF E0 AF BE 00 18  AF B0 00 10 AF B1 00 14  |'...............|
80010010: 27 BD FF A0 0C 00 48 20  00 00 00 00 00 00 00 00  |'......H........|
```

**Commit :** `feat(mcp-server): add memory read/write/search MCP tools`

---

## TÂCHE 9 — MCP Tools : Registres et désassemblage

**Fichier :** `tools/mcp-server/src/tools/disassembly.ts`

**But :** Exposer les registres CPU et le désassembleur à l'IA.

**Outils à exposer :**

| Tool MCP | Description | Paramètres |
|---|---|---|
| `pcsx_get_registers` | Lire tous les registres MIPS | aucun |
| `pcsx_disassemble` | Désassembler N instructions | `address: string, count?: number` |
| `pcsx_get_pc` | Obtenir le PC courant | aucun |
| `pcsx_jump_to_pc` | Aller à une adresse dans le debugger | `address: string` |

**Format de sortie `pcsx_disassemble` :**
```
GameMain (0x80010000):
  80010000:  27bdffe0   addiu  $sp, $sp, -0x20
  80010004:  afbe0018   sw     $s8, 0x18($sp)
  80010008:  03a0f025   move   $s8, $sp
  0x8001000c:  0c004820   jal    0x80012080
  80010010:  00000000   nop
```

**Commit :** `feat(mcp-server): add registers and disassembly MCP tools`

---

## TÂCHE 10 — MCP Tools : Breakpoints

**Fichier :** `tools/mcp-server/src/tools/debug.ts`

**But :** Permettre à l'IA de poser des breakpoints et d'analyser l'exécution.

**Outils à exposer :**

| Tool MCP | Description | Paramètres |
|---|---|---|
| `pcsx_list_breakpoints` | Lister tous les breakpoints | aucun |
| `pcsx_add_breakpoint` | Ajouter un breakpoint | `address: string, type: "exec"\|"read"\|"write", width?: number, label?: string` |
| `pcsx_remove_breakpoint` | Supprimer un breakpoint | `address: string, type: "exec"\|"read"\|"write"` |
| `pcsx_enable_breakpoint` | Activer/désactiver | `address: string, type: string, enabled: boolean` |
| `pcsx_wait_for_break` | Attendre que l'émulateur pause (polling) | `timeout_ms?: number` |

**Commit :** `feat(mcp-server): add breakpoints MCP tools`

---

## TÂCHE 11 — MCP Tools : CD-ROM et fichiers

**Fichier :** `tools/mcp-server/src/tools/cdrom.ts`

**But :** Permettre à l'IA d'explorer l'ISO du jeu.

**Outils à exposer :**

| Tool MCP | Description | Paramètres |
|---|---|---|
| `pcsx_cdrom_info` | Infos sur le CD chargé | aucun |
| `pcsx_cdrom_read_file` | Lire un fichier de l'ISO | `filename: string` |
| `pcsx_cdrom_list_files` | Lister les fichiers ISO | aucun (via lecture du répertoire ISO) |
| `pcsx_upload_symbols` | Uploader des symboles addr→nom | `symbols: Record<string, string>` |

**Note :** Pour `pcsx_cdrom_list_files`, lire le fichier spécial `\` (racine ISO 9660) ou parcourir via plusieurs requêtes `cd/files`.

**Commit :** `feat(mcp-server): add CD-ROM and symbols MCP tools`

---

## TÂCHE 12 — MCP Tools : Save States et VRAM

**Fichier :** `tools/mcp-server/src/tools/memory.ts` (extension)

**But :** Save states pour snapshots d'analyse, et dump VRAM pour analyse graphique.

**Outils à exposer :**

| Tool MCP | Description | Paramètres |
|---|---|---|
| `pcsx_create_savestate` | Créer un savestate (base64) | aucun |
| `pcsx_load_savestate` | Charger un savestate | `data: string (base64)` |
| `pcsx_get_vram` | Dump VRAM GPU en PNG base64 | aucun |
| `pcsx_screenshot` | Screenshot de l'écran courant | aucun |

**Commit :** `feat(mcp-server): add savestate and VRAM MCP tools`

---

## TÂCHE 13 — Documentation et README

**Fichiers :** `tools/mcp-server/README.md`, `.vscode/mcp.json`

**But :** Documenter l'usage du MCP server pour reverse engineering de jeux PSX.

**Contenu README :**
1. Prérequis (PCSX-Redux avec Web Server activé, port 8080)
2. Configuration GDB server (port 3333)
3. Installation : `npm install && npm run build`
4. Configuration VS Code MCP (copier `.vscode/mcp.json`)
5. Exemple de session d'analyse avec GitHub Copilot
6. Liste complète des outils MCP disponibles
7. Exemple complet : trouver et analyser `GameMain` dans Parasite Eve

**Exemple de session dans le README :**
```
User: Lis les 20 premières instructions à l'adresse 0x80010000 et explique ce que fait cette fonction
Copilot: [appelle pcsx_disassemble(0x80010000, 20)] → analyse le prologue de fonction...

User: Cherche la chaîne "PARASITE" dans la RAM
Copilot: [appelle pcsx_search_memory("50415241534954")] → trouvé à 0x800F4320...

User: Pose un breakpoint sur 0x80023400 et attends qu'il soit touché
Copilot: [appelle pcsx_add_breakpoint + pcsx_resume + pcsx_wait_for_break] → ...
```

**Commit :** `docs(mcp-server): add README and VS Code MCP configuration`

---

## TÂCHE 14 — Tests d'intégration

**Répertoire :** `tools/mcp-server/tests/`

**But :** Valider que chaque outil MCP fonctionne correctement avec PCSX-Redux.

**Tests à écrire :**
- `test-connection.ts` : vérifie que le serveur HTTP PCSX est accessible
- `test-memory.ts` : lit 16 octets à `0x80000000`, vérifie que ce n'est pas zéro
- `test-registers.ts` : lit les registres, vérifie que `pc` est une adresse valide
- `test-disassemble.ts` : désassemble 5 instructions au PC courant
- `test-breakpoints.ts` : add/list/remove un breakpoint exec
- `test-cdrom.ts` : vérifie les infos CD-ROM

**Commit :** `test(mcp-server): add integration tests for all MCP tools`

---

## Ordre d'exécution recommandé

```
TÂCHE 1  → TÂCHE 2  → TÂCHE 3  → TÂCHE 4  → TÂCHE 5   (modifications C++ web-server)
    ↓
TÂCHE 6                                                   (scaffold Node.js)
    ↓
TÂCHE 7  → TÂCHE 8  → TÂCHE 9  → TÂCHE 10 → TÂCHE 11   (outils MCP)
    ↓
TÂCHE 12 → TÂCHE 13 → TÂCHE 14                           (finition)
```

---

## Notes techniques

### Accès aux structures internes C++ (pour les tâches 1-5)

```cpp
// RAM
uint8_t* ram = PCSX::g_emulator->m_mem->m_wram;
uint32_t ramSize = PCSX::g_emulator->settings.get<PCSX::Emulator::Setting8MB>().value ? 8*1024*1024 : 2*1024*1024;

// Registres
auto& regs = PCSX::g_emulator->m_cpu->m_psxRegs;
uint32_t pc = regs.pc;
uint32_t sp = regs.GPR.n.sp;

// Debug
auto& debug = *PCSX::g_emulator->m_debug;

// Symboles
auto& symbols = PCSX::g_emulator->m_cpu->m_symbols; // std::map<uint32_t, std::string>

// Désassemblage
char buf[64];
PCSX::Disasm::disassemble(address, opcode, buf);
```

### Normalisation des adresses PSX

```cpp
// PSX memory mirrors : 0x00000000, 0x80000000, 0xA0000000 → même RAM physique
uint32_t normalizeAddr(uint32_t addr) {
    return addr & 0x1FFFFF; // pour RAM 2MB
    // ou addr & 0x7FFFFF pour RAM 8MB
}
```

### Variables d'environnement MCP server

| Variable | Défaut | Description |
|---|---|---|
| `PCSX_HOST` | `localhost` | Hôte du serveur PCSX-Redux |
| `PCSX_PORT` | `8080` | Port HTTP PCSX-Redux |
| `PCSX_GDB_PORT` | `3333` | Port GDB Server PCSX-Redux |
| `PCSX_TIMEOUT` | `10000` | Timeout HTTP en ms |

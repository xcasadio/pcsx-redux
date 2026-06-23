/***************************************************************************
 *   Copyright (C) 2019 PCSX-Redux authors                                 *
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

#pragma once

#include <stdio.h>

#include "json.hpp"
#include "lua/luawrapper.h"

using json = nlohmann::json;

namespace PCSX {

class GUI;

class Pads {
  public:
    enum class Port { Port1 = 0, Port2 };

    virtual ~Pads() = default;

    virtual void init() = 0;
    virtual void shutdown() = 0;
    virtual uint8_t startPoll(Port port) = 0;
    virtual uint8_t poll(uint8_t value, Port port, uint32_t& padState) = 0;

    virtual json getCfg() = 0;
    virtual void setCfg(const json& j) = 0;
    virtual void setDefaults() = 0;
    virtual bool configure(PCSX::GUI* gui) = 0;

    virtual void reset() = 0;

    virtual void setLua(PCSX::Lua L) = 0;

    virtual bool isPadConnected(int pad) = 0;

    // Button override: forces a button pressed regardless of physical input.
    // button index: select=0, start=3, up=4, right=5, down=6, left=7,
    //               l2=8, r2=9, l1=10, r1=11, triangle=12, circle=13, cross=14, square=15
    virtual void setPadButtonOverride(Port port, int button) = 0;
    virtual void clearPadButtonOverride(Port port, int button) = 0;
    virtual void clearAllPadOverrides(Port port) = 0;
    virtual uint16_t getPadOverrides(Port port) = 0;

    bool m_showCfg = false;

    enum {
        PAD_STATE_IDLE = 0,
        PAD_STATE_READ_COMMAND = 1,
        PAD_STATE_READ_DATA = 2,
        PAD_STATE_BAD_COMMAND = 3,
    };

    static Pads* factory();
};

}  // namespace PCSX

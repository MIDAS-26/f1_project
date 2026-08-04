"""Finite driver roster used across live simulation and replay.

Full 2024-season 20-driver grid across 10 teams, so the live simulation
represents a realistic field rather than an arbitrary handful of cars.
Replay mode overlays real FastF1 driver info on top of this where
available, falling back to this roster for color/name when a session
doesn't expose full driver info.
"""

DRIVER_ROSTER = [
    # Red Bull Racing
    {"driver": 1,  "code": "VER", "name": "Max Verstappen",   "team": "Red Bull Racing", "color": "#3671C6"},
    {"driver": 11, "code": "PER", "name": "Sergio Pérez",      "team": "Red Bull Racing", "color": "#3671C6"},
    # Ferrari
    {"driver": 16, "code": "LEC", "name": "Charles Leclerc",   "team": "Ferrari",         "color": "#F91536"},
    {"driver": 55, "code": "SAI", "name": "Carlos Sainz",      "team": "Ferrari",         "color": "#F91536"},
    # Mercedes
    {"driver": 44, "code": "HAM", "name": "Lewis Hamilton",    "team": "Mercedes",        "color": "#6CD3BF"},
    {"driver": 63, "code": "RUS", "name": "George Russell",    "team": "Mercedes",        "color": "#6CD3BF"},
    # McLaren
    {"driver": 4,  "code": "NOR", "name": "Lando Norris",      "team": "McLaren",         "color": "#F58020"},
    {"driver": 81, "code": "PIA", "name": "Oscar Piastri",     "team": "McLaren",         "color": "#F58020"},
    # Aston Martin
    {"driver": 14, "code": "ALO", "name": "Fernando Alonso",   "team": "Aston Martin",    "color": "#358C75"},
    {"driver": 18, "code": "STR", "name": "Lance Stroll",      "team": "Aston Martin",    "color": "#358C75"},
    # Alpine
    {"driver": 10, "code": "GAS", "name": "Pierre Gasly",      "team": "Alpine",          "color": "#2293D1"},
    {"driver": 31, "code": "OCO", "name": "Esteban Ocon",      "team": "Alpine",          "color": "#2293D1"},
    # Williams
    {"driver": 23, "code": "ALB", "name": "Alexander Albon",   "team": "Williams",        "color": "#37BEDD"},
    {"driver": 2,  "code": "SAR", "name": "Logan Sargeant",    "team": "Williams",        "color": "#37BEDD"},
    # RB (VCARB)
    {"driver": 22, "code": "TSU", "name": "Yuki Tsunoda",      "team": "RB",              "color": "#5E8FAA"},
    {"driver": 3,  "code": "RIC", "name": "Daniel Ricciardo",  "team": "RB",              "color": "#5E8FAA"},
    # Kick Sauber
    {"driver": 77, "code": "BOT", "name": "Valtteri Bottas",   "team": "Kick Sauber",     "color": "#52E252"},
    {"driver": 24, "code": "ZHO", "name": "Zhou Guanyu",       "team": "Kick Sauber",     "color": "#52E252"},
    # Haas
    {"driver": 20, "code": "MAG", "name": "Kevin Magnussen",   "team": "Haas",            "color": "#B6BABD"},
    {"driver": 27, "code": "HUL", "name": "Nico Hülkenberg",   "team": "Haas",            "color": "#B6BABD"},
]

DRIVER_BY_NUMBER = {d["driver"]: d for d in DRIVER_ROSTER}

# Full grid used for the live simulation — every driver on the roster
SIM_DRIVER_NUMBERS = [d["driver"] for d in DRIVER_ROSTER]


def driver_by_number(number: int) -> dict:
    """Look up roster metadata by driver number, with a safe fallback."""
    d = DRIVER_BY_NUMBER.get(int(number))
    if d:
        return d
    return {
        "driver": int(number),
        "code": f"D{number}",
        "name": f"Driver {number}",
        "team": "Unknown",
        "color": "#888888",
    }

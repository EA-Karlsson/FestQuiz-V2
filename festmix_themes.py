"""Map Festmix editorial themes to the choices available to the host."""

FESTMIX_THEMES = {
    "odd": "Knasiga fakta",
    "film": "Film och tv",
    "music": "Musik",
    "retro": "Spel och prylar",
    "world": "Mat och traditioner",
}

_EDITORIAL_THEMES = {
    "odd": (
        "aprilskämt",
        "djur",
        "djur med jobb",
        "djurens oväntade knep",
        "forskning",
        "knasig forskning",
        "kända namn",
        "litteratur",
        "människokroppen",
        "märkliga experiment",
        "märkliga händelser",
        "naturens överraskningar",
        "ord",
        "ord och uttryck",
        "oväntad historia",
        "oväntade jobb",
        "rekord",
        "rymd och rymdfart",
        "rymden",
        "samband",
        "siffror",
        "siffror som överraskar",
        "sport",
        "udda",
        "udda museiföremål",
    ),
    "film": ("bakom kameran", "tvnostalgi"),
    "music": ("artistnamn", "festhits"),
    "retro": (
        "knasiga uppfinningar",
        "konstiga vardagsprylar",
        "kända märken",
        "nostalgi",
        "prylar",
        "retro",
        "spel",
        "uppfinningar och prylar",
    ),
    "world": (
        "jorden runt",
        "mat",
        "mat och dryck",
        "mode och symboler",
        "norden",
        "symboler",
        "sägner och skrock",
        "traditioner",
        "världens vanor",
    ),
}

_THEME_IDS = {
    label: theme_id
    for theme_id, title in FESTMIX_THEMES.items()
    for label in (theme_id, title.casefold(), *_EDITORIAL_THEMES[theme_id])
}


def festmix_theme(theme: object) -> str | None:
    """Return the selectable theme ID for a curated question's theme label."""
    if not isinstance(theme, str):
        return None
    label = " ".join(theme.casefold().replace("_", " ").split())
    return _THEME_IDS.get(label)

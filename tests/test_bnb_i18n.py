"""Localisation is structural here, so it is asserted on rather than eyeballed."""

import pytest

from bnb.i18n import LANGUAGES, RTL, STRINGS, bundle, missing_keys, normalise


def test_every_language_translates_every_string():
    """A gap ships as English mid-sentence, which reads as a bug to the owner."""
    assert missing_keys() == {}


def test_every_shipped_language_is_named_in_its_own_script():
    """A language picker in English only helps people who read English."""
    assert set(LANGUAGES) == set(STRINGS)
    assert LANGUAGES["de"] == "Deutsch"
    assert LANGUAGES["ar"] == "العربية"


@pytest.mark.parametrize("given,expected", [
    ("pt-BR", "pt"), ("PT_br", "pt"), ("en-GB", "en"),
    ("es", "es"), ("zz", "en"), (None, "en"), ("", "en"),
])
def test_locale_tags_are_narrowed_to_a_shipped_bundle(given, expected):
    assert normalise(given) == expected


def test_right_to_left_languages_report_their_direction():
    assert bundle("ar")["dir"] == "rtl"
    assert bundle("en")["dir"] == "ltr"
    assert "ar" in RTL


def test_an_unknown_locale_falls_back_without_losing_strings():
    fallback = bundle("kl-GL")
    assert fallback["locale"] == "en"
    assert set(fallback["strings"]) == set(STRINGS["en"])


def test_a_partial_translation_falls_back_key_by_key(monkeypatch):
    """Half a translation should ship half the coverage, not none of it."""
    monkeypatch.setitem(STRINGS, "xx", {"nav.today": "Hoje-ish"})
    monkeypatch.setitem(LANGUAGES, "xx", "Testish")
    strings = bundle("xx")["strings"]
    assert strings["nav.today"] == "Hoje-ish"
    assert strings["nav.calendar"] == STRINGS["en"]["nav.calendar"]


def test_placeholders_match_across_translations():
    """A translation that drops {nights} silently hides the clashing dates."""
    import re
    for key, english in STRINGS["en"].items():
        expected = set(re.findall(r"\{(\w+)\}", english))
        for code, strings in STRINGS.items():
            if key in strings:
                assert set(re.findall(r"\{(\w+)\}", strings[key])) == expected, f"{code}:{key}"

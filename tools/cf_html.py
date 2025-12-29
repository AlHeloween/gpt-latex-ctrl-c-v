"""
CF_HTML (Windows "HTML Format") parsing + validation helpers.

This module is intentionally dependency-free (stdlib only) so it can be reused from
tests and debugging tools.
"""

from __future__ import annotations

import dataclasses
import hashlib
import re
from typing import Any


_OFFSET_KEYS = (
    "StartHTML",
    "EndHTML",
    "StartFragment",
    "EndFragment",
    "StartSelection",
    "EndSelection",
)

_OFFSETS_RE = re.compile(
    r"(?m)^(StartHTML|EndHTML|StartFragment|EndFragment|StartSelection|EndSelection):([0-9]{8,})\s*$"
)

# Specs/docs mention variants with a space before "-->".
_START_MARKERS = (
    b"<!--StartFragment-->",
    b"<!--StartFragment -->",
)
_END_MARKERS = (
    b"<!--EndFragment-->",
    b"<!--EndFragment -->",
)


@dataclasses.dataclass(frozen=True)
class CfHtmlOffsets:
    offsets: dict[str, int]

    def get(self, key: str) -> int | None:
        return self.offsets.get(key)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _trim_nul(data: bytes) -> bytes:
    # Clipboard CF_HTML is typically UTF-8 with an optional trailing NUL.
    return data.split(b"\x00", 1)[0]


def parse_offsets_from_bytes(data: bytes) -> CfHtmlOffsets:
    """
    Parse CF_HTML header offsets.

    Offsets are returned as absolute byte offsets into the full CF_HTML byte payload.
    """
    head_end = data.find(b"<")
    head = data if head_end < 0 else data[:head_end]
    text = head.decode("ascii", errors="ignore")
    found = dict((k, int(v)) for (k, v) in _OFFSETS_RE.findall(text))
    return CfHtmlOffsets(offsets=found)


def _find_all(haystack: bytes, needle: bytes, *, start: int, end: int, max_hits: int) -> tuple[list[int], bool]:
    hits: list[int] = []
    pos = start
    truncated = False
    while True:
        i = haystack.find(needle, pos, end)
        if i < 0:
            break
        hits.append(i)
        pos = i + len(needle)
        if len(hits) >= max_hits:
            truncated = True
            break
    return hits, truncated


def validate_cf_html_bytes(data_raw: bytes, *, max_marker_positions: int = 10) -> dict[str, Any]:
    """
    Validate CF_HTML structure.

    Returns a JSON-serializable dict:
    - ok: bool
    - errors: list[str]
    - offsets: dict[str,int]
    - markers: positions (limited)
    - derived: marker-based expected offsets (best-effort)
    """
    data = _trim_nul(data_raw)
    errors: list[str] = []

    offsets = parse_offsets_from_bytes(data).offsets

    start_html = offsets.get("StartHTML")
    end_html = offsets.get("EndHTML")
    start_frag = offsets.get("StartFragment")
    end_frag = offsets.get("EndFragment")

    if start_html is None or end_html is None:
        errors.append("missing StartHTML/EndHTML")
        return {"ok": False, "errors": errors, "offsets": offsets, "markers": {}, "derived": {}}

    if not (0 <= start_html <= len(data)):
        errors.append(f"StartHTML out of range: {start_html} (len={len(data)})")
    if not (0 <= end_html <= len(data)):
        errors.append(f"EndHTML out of range: {end_html} (len={len(data)})")
    if start_html is not None and end_html is not None and start_html >= end_html:
        errors.append(f"StartHTML >= EndHTML ({start_html} >= {end_html})")

    if start_html is not None and 0 <= start_html < len(data):
        # Some producers point StartHTML at whitespace before the '<html...>' tag.
        probe = data[start_html : min(len(data), start_html + 64)]
        j = 0
        while j < len(probe) and probe[j] in b" \t\r\n":
            j += 1
        if j >= len(probe) or probe[j : j + 1] != b"<":
            errors.append("StartHTML does not point to '<' (may indicate bad offsets)")

    if start_frag is not None and end_frag is not None:
        if not (0 <= start_frag <= len(data)):
            errors.append(f"StartFragment out of range: {start_frag} (len={len(data)})")
        if not (0 <= end_frag <= len(data)):
            errors.append(f"EndFragment out of range: {end_frag} (len={len(data)})")
        if start_frag >= end_frag:
            errors.append(f"StartFragment >= EndFragment ({start_frag} >= {end_frag})")
        if start_frag < start_html or end_frag > end_html:
            errors.append(
                f"fragment not within html bounds (StartHTML={start_html}, EndHTML={end_html}, "
                f"StartFragment={start_frag}, EndFragment={end_frag})"
            )

    # Marker scans (best-effort; avoid huge JSON on pathological inputs).
    markers: dict[str, Any] = {}
    derived: dict[str, Any] = {}
    if 0 <= start_html < end_html <= len(data):
        html_region = (start_html, end_html)
        start_hits: list[int] = []
        start_truncated = False
        for m in _START_MARKERS:
            hits, trunc = _find_all(data, m, start=start_html, end=end_html, max_hits=max_marker_positions)
            start_hits.extend(hits)
            start_truncated = start_truncated or trunc
        start_hits = sorted(set(start_hits))

        end_hits: list[int] = []
        end_truncated = False
        for m in _END_MARKERS:
            hits, trunc = _find_all(data, m, start=start_html, end=end_html, max_hits=max_marker_positions)
            end_hits.extend(hits)
            end_truncated = end_truncated or trunc
        end_hits = sorted(set(end_hits))

        markers = {
            "start_marker_positions": start_hits,
            "end_marker_positions": end_hits,
            "start_marker_positions_truncated": start_truncated,
            "end_marker_positions_truncated": end_truncated,
        }

        # Markers are commonly present but not strictly required (offsets are authoritative).
        # If present, require a single unambiguous pair.
        if start_hits or end_hits:
            if len(start_hits) != 1:
                errors.append(f"expected exactly 1 StartFragment marker, found {len(start_hits)}")
            if len(end_hits) != 1:
                errors.append(f"expected exactly 1 EndFragment marker, found {len(end_hits)}")

        chosen_start = start_hits[0] if len(start_hits) == 1 else None
        chosen_end = end_hits[0] if len(end_hits) == 1 else None
        markers["chosen_start_marker_pos"] = chosen_start
        markers["chosen_end_marker_pos"] = chosen_end

        if chosen_start is not None and chosen_end is not None:
            # Compute possible expected offsets (different producers pick different conventions).
            start_len = None
            for m in _START_MARKERS:
                if data.startswith(m, chosen_start):
                    start_len = len(m)
                    break
            end_len = None
            for m in _END_MARKERS:
                if data.startswith(m, chosen_end):
                    end_len = len(m)
                    break

            derived = {
                "expected_scheme_A": {  # includes comment markers
                    "StartFragment": chosen_start,
                    "EndFragment": (chosen_end + (end_len or 0)),
                },
                "expected_scheme_B": {  # excludes comment markers (points to fragment text)
                    "StartFragment": chosen_start + (start_len or 0),
                    "EndFragment": chosen_end,
                },
                "expected_scheme_C": {  # after start marker -> after end marker
                    "StartFragment": chosen_start + (start_len or 0),
                    "EndFragment": chosen_end + (end_len or 0),
                },
            }

            if start_frag is not None and end_frag is not None:
                ok_any = (
                    (start_frag, end_frag)
                    in (
                        (derived["expected_scheme_A"]["StartFragment"], derived["expected_scheme_A"]["EndFragment"]),
                        (derived["expected_scheme_B"]["StartFragment"], derived["expected_scheme_B"]["EndFragment"]),
                        (derived["expected_scheme_C"]["StartFragment"], derived["expected_scheme_C"]["EndFragment"]),
                    )
                )
                if not ok_any:
                    errors.append(
                        "StartFragment/EndFragment do not match any marker-based scheme "
                        f"(got {start_frag}..{end_frag})"
                    )

    return {"ok": not errors, "errors": errors, "offsets": offsets, "markers": markers, "derived": derived}

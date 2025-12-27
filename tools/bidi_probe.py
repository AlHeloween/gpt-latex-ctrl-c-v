"""
Deterministic Firefox probe using WebDriver BiDi (via Selenium).

Design rules:
- No "network idle" or framework readiness events as proof of load.
- Every wait is an explicit wait_until(predicate) with a deadline and polling.
- Produce inspectable artifacts (HTML, subtree HTML, screenshot, console logs, extracted JSON).
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

from selenium import webdriver
from selenium.webdriver.firefox.options import Options as FirefoxOptions


@dataclass
class PredicatePoll:
    t_ms: int
    ok: bool
    value: Any


def _now_ms() -> int:
    return int(time.time() * 1000)


def wait_until(
    predicate: Callable[[], Any],
    *,
    deadline_s: float,
    poll_s: float,
    name: str,
    log: Callable[[str], None],
) -> tuple[bool, list[PredicatePoll], Any]:
    start_ms = _now_ms()
    end_ms = start_ms + int(deadline_s * 1000)
    polls: list[PredicatePoll] = []
    last_value: Any = None

    log(f"[wait_until] name={name} deadline_s={deadline_s} poll_s={poll_s}")
    while _now_ms() <= end_ms:
        try:
            last_value = predicate()
            ok = bool(last_value)
        except Exception as e:  # noqa: BLE001 - intentional: capture probe failures as values
            ok = False
            last_value = {"error": str(e), "type": type(e).__name__}

        poll = PredicatePoll(t_ms=_now_ms() - start_ms, ok=ok, value=last_value)
        polls.append(poll)
        log(f"[wait_until] t_ms={poll.t_ms} ok={poll.ok} value={_short(poll.value)}")

        if ok:
            return True, polls, last_value

        time.sleep(poll_s)

    return False, polls, last_value


def _short(value: Any, limit: int = 180) -> str:
    try:
        s = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    except Exception:
        s = repr(value)
    s = s.replace("\r", "\\r").replace("\n", "\\n")
    return s if len(s) <= limit else s[: limit - 3] + "..."


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _diff_text(a: str, b: str, *, a_name: str, b_name: str) -> str:
    return "\n".join(
        difflib.unified_diff(
            a.splitlines(),
            b.splitlines(),
            fromfile=a_name,
            tofile=b_name,
            lineterm="",
        )
    )


def _capabilities_snapshot(caps: dict[str, Any]) -> dict[str, Any]:
    # Keep this stable and debuggable: include the most useful fields only.
    keys = [
        "browserName",
        "browserVersion",
        "platformName",
        "moz:geckodriverVersion",
        "moz:profile",
        "webSocketUrl",
    ]
    out: dict[str, Any] = {k: caps.get(k) for k in keys if k in caps}
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic Firefox WebDriver BiDi probe + artifacts.")
    parser.add_argument("--url", required=True, help="URL to open (e.g., file:///... or http://...).")
    parser.add_argument(
        "--artifacts",
        default=str(Path("artifacts") / "bidi_probe"),
        help="Directory to write artifacts (default: artifacts/bidi_probe).",
    )
    parser.add_argument(
        "--selector",
        default="body",
        help="CSS selector for target subtree artifact (default: body).",
    )
    parser.add_argument(
        "--require-subtree",
        action="store_true",
        help="Fail the run if the target selector is not found (target_subtree.html would be empty).",
    )
    parser.add_argument(
        "--expected-subtree",
        default="",
        help="Optional path to expected subtree HTML (exact string match). Writes diff.txt on mismatch.",
    )
    parser.add_argument("--headless", action="store_true", help="Run headless (default is headful).")
    parser.add_argument("--deadline-s", type=float, default=20.0, help="Max wait time for predicates.")
    parser.add_argument("--poll-s", type=float, default=0.2, help="Predicate polling interval.")
    args = parser.parse_args()

    artifacts_dir = Path(args.artifacts)
    run_log_path = artifacts_dir / "run.log"
    console_log_path = artifacts_dir / "console.log"
    page_html_path = artifacts_dir / "page.html"
    subtree_html_path = artifacts_dir / "target_subtree.html"
    screenshot_path = artifacts_dir / "screenshot.png"
    extracted_path = artifacts_dir / "extracted.json"
    diff_path = artifacts_dir / "diff.txt"

    run_lines: list[str] = []

    def log(line: str) -> None:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        msg = f"{ts} {line}"
        print(msg, flush=True)
        run_lines.append(msg)

    log("[precondition] require Firefox installed + geckodriver available via Selenium Manager or PATH")
    log(f"[action] create driver headless={args.headless} with capability webSocketUrl=true")

    options = FirefoxOptions()
    options.headless = bool(args.headless)
    options.set_capability("webSocketUrl", True)

    # Keep the run deterministic: prefer a clean temporary profile unless the user opts out.
    # Selenium will create a fresh profile by default; do not reuse persistent state.

    # Selenium 4.39.0 expects log.entryAdded JavaScript events to include "stackTrace".
    # Firefox can omit it; monkeypatch defensively so BiDi console capture doesn't crash threads.
    try:
        from selenium.webdriver.common.bidi.log import JavaScriptLogEntry  # noqa: WPS433 - runtime patch is intentional

        _orig_from_json = JavaScriptLogEntry.from_json.__func__  # type: ignore[attr-defined]

        def _from_json_safe(cls, json_data):  # noqa: ANN001 - third-party shape
            if isinstance(json_data, dict) and "stackTrace" not in json_data:
                json_data = dict(json_data)
                json_data["stackTrace"] = None
            return _orig_from_json(cls, json_data)

        JavaScriptLogEntry.from_json = classmethod(_from_json_safe)  # type: ignore[assignment]
    except Exception:
        pass

    console_entries: list[dict[str, Any]] = []
    js_errors: list[dict[str, Any]] = []

    driver = webdriver.Firefox(options=options)
    try:
        caps = driver.capabilities
        log(f"[postcondition] driver started; caps={_short(_capabilities_snapshot(caps))}")
        if not caps.get("webSocketUrl"):
            log("[postcondition] FAIL: webSocketUrl missing; BiDi not enabled")
            return 2

        # BiDi console + JS error capture (observable artifacts).
        try:
            driver.script.add_console_message_handler(lambda e: console_entries.append(asdict(e)))
            driver.script.add_javascript_error_handler(lambda e: js_errors.append(asdict(e)))
            log("[action] attached BiDi console/javascript_error handlers")
        except Exception as e:  # noqa: BLE001
            log(f"[action] WARN: could not attach BiDi handlers: {type(e).__name__}: {e}")

        log(f"[action] navigate url={args.url}")
        driver.get(args.url)

        # Prove DOM usability (mutation + reflection) instead of black-box load events.
        ok_ready, polls_ready, _ = wait_until(
            lambda: driver.execute_script(
                "return document.readyState === 'interactive' || document.readyState === 'complete';"
            ),
            deadline_s=args.deadline_s,
            poll_s=args.poll_s,
            name="document.readyState interactive|complete",
            log=log,
        )
        if not ok_ready:
            log("[postcondition] FAIL: readyState predicate did not pass")

        ok_body, polls_body, _ = wait_until(
            lambda: driver.execute_script("return !!document.body;"),
            deadline_s=args.deadline_s,
            poll_s=args.poll_s,
            name="document.body exists",
            log=log,
        )
        if not ok_body:
            log("[postcondition] FAIL: body predicate did not pass")

        probe_token = driver.execute_script(
            """
            const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            let el = document.getElementById("__bidi_dom_probe");
            if (!el) {
              el = document.createElement("div");
              el.id = "__bidi_dom_probe";
              el.style.display = "none";
              document.documentElement.appendChild(el);
            }
            el.textContent = token;
            return token;
            """
        )

        ok_probe, polls_probe, _ = wait_until(
            lambda: driver.execute_script(
                "return document.getElementById('__bidi_dom_probe')?.textContent === arguments[0];",
                probe_token,
            ),
            deadline_s=args.deadline_s,
            poll_s=args.poll_s,
            name="DOM mutation reflected (__bidi_dom_probe)",
            log=log,
        )
        if not ok_probe:
            log("[postcondition] FAIL: DOM mutation was not reflected")

        log("[action] capture artifacts (page html, subtree html, screenshot, console logs, extracted json)")
        page_html = driver.page_source or ""
        subtree_html = driver.execute_script(
            """
            const sel = arguments[0];
            const el = document.querySelector(sel);
            return el ? el.outerHTML : null;
            """,
            args.selector,
        )
        subtree_found = isinstance(subtree_html, str) and len(subtree_html) > 0
        subtree_html = subtree_html if isinstance(subtree_html, str) else ""
        if not subtree_found:
            log(f"[postcondition] WARN: selector not found (empty target_subtree.html): selector={args.selector!r}")
            if args.require_subtree:
                log("[postcondition] FAIL: --require-subtree set and selector was not found")

        _write_text(page_html_path, page_html)
        _write_text(subtree_html_path, subtree_html)
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(screenshot_path))

        # Prefer BiDi-captured logs; they are inspectable and reflect browser reality.
        console_lines: list[str] = []
        for item in console_entries:
            console_lines.append(json.dumps({"type": "console", **item}, ensure_ascii=False))
        for item in js_errors:
            console_lines.append(json.dumps({"type": "js_error", **item}, ensure_ascii=False))
        _write_text(console_log_path, "\n".join(console_lines) + ("\n" if console_lines else ""))

        predicates = {
            "readyState": [asdict(p) for p in polls_ready],
            "bodyExists": [asdict(p) for p in polls_body],
            "domProbe": [asdict(p) for p in polls_probe],
        }

        extracted = {
            "url": args.url,
            "selector": args.selector,
            "subtree_found": bool(subtree_found),
            "headless": bool(args.headless),
            "deadline_s": args.deadline_s,
            "poll_s": args.poll_s,
            "capabilities": _capabilities_snapshot(caps),
            "env": {"os": os.name},
            "predicates": predicates,
            "console_counts": {"console": len(console_entries), "js_error": len(js_errors)},
        }
        _write_json(extracted_path, extracted)
        _write_text(run_log_path, "\n".join(run_lines) + "\n")

        expected_path = Path(args.expected_subtree) if args.expected_subtree else None
        if expected_path:
            expected = _read_text(expected_path)
            if expected != subtree_html:
                _write_text(diff_path, _diff_text(expected, subtree_html, a_name=str(expected_path), b_name="actual"))
                log(f"[postcondition] FAIL: subtree mismatch; wrote {diff_path}")
                return 3

        if not (ok_ready and ok_body and ok_probe):
            log(f"[postcondition] FAIL: one or more predicates failed; artifacts at {artifacts_dir}")
            return 4
        if args.require_subtree and not subtree_found:
            log(f"[postcondition] FAIL: selector not found; artifacts at {artifacts_dir}")
            return 5

        log(f"[postcondition] OK: artifacts at {artifacts_dir}")
        return 0
    finally:
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

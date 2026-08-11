"""CrewAI strategy deliberation powered by OpenRouter (free-tier models only).

One CrewAI agent reasons through race-engineer, tyre-analyst, and strategist
perspectives internally and produces a single final verdict — one LLM call
per tripwire, not three. This used to be three separate sequential agents
(each a full LLM round-trip), which burned OpenRouter's free-tier daily quota
3x faster than necessary for output that was always going to collapse into
one recommendation anyway.

LLM: OpenRouter (OpenAI-compatible), routed through litellm's
`openrouter/<model>` provider prefix. Only models confirmed to carry
zero prompt/completion cost on OpenRouter's live pricing feed are allowed —
see FREE_MODEL_ALLOWLIST. This is a hardcoded allowlist, not a wildcard on
model name, so a model can't silently start being billed without this file
being updated to match.
"""

import os
import time
import asyncio
import json
import random
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Models confirmed $0/$0 prompt+completion pricing on OpenRouter as of the
# last manual check against https://openrouter.ai/api/v1/models. Keep this
# list in sync if you re-verify — never widen it to a prefix/wildcard match,
# since OpenRouter model pricing can change or a similarly-named paid
# variant can exist alongside a free one.
FREE_MODEL_ALLOWLIST = {
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "nvidia/nemotron-nano-9b-v2:free",
    "openai/gpt-oss-20b:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.0-tiny:free",
    "openrouter/free",
}

_requested_model = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free")
if _requested_model not in FREE_MODEL_ALLOWLIST:
    raise RuntimeError(
        f"Refusing to use OPENROUTER_MODEL={_requested_model!r}: not in FREE_MODEL_ALLOWLIST. "
        f"Re-verify pricing at openrouter.ai/models and add it to agents.FREE_MODEL_ALLOWLIST "
        f"if it is genuinely free, or pick one of: {sorted(FREE_MODEL_ALLOWLIST)}"
    )
OPENROUTER_MODEL = _requested_model

HAS_LLM_KEY = bool(OPENROUTER_API_KEY)


# --- CrewAI Setup ---

from crewai import Agent, Task, Crew, Process, LLM
import litellm
import openai

# litellm's OpenRouter provider reads OPENROUTER_API_KEY from the environment;
# passing api_key explicitly too so this doesn't depend on load order elsewhere.
#
# max_retries=0: this CrewAI version routes "openrouter/..." models through
# its *native* OpenAICompatibleCompletion class (an OpenAI-SDK client), not
# litellm — so this is the OpenAI SDK client's own retry count, defaulting
# to 2 (3 attempts total per call). Left at the default, a single daily-quota
# 429 would silently retry 3x internally before our own circuit breaker or
# backoff logic in deliberate() ever saw the exception, burning 3x the quota
# on guaranteed-fail requests. Must be passed as a direct constructor kwarg
# (not inside additional_params, which gets forwarded raw into the
# provider's completions.create() call and isn't a valid param there).
openrouter_llm = LLM(
    model=f"openrouter/{OPENROUTER_MODEL}",
    api_key=OPENROUTER_API_KEY,
    max_retries=0,
) if HAS_LLM_KEY else None


# --- Circuit breaker for daily-quota exhaustion ---
#
# OpenRouter's free tier is capped at a fixed number of requests *per day*
# (reported via X-RateLimit-Remaining / X-RateLimit-Reset on a 429 response
# with limit_source "openrouter_free_tier_daily"). That is fundamentally
# different from a transient rate limit: retrying does nothing but burn
# more of tomorrow's quota on guaranteed failures, and left unguarded this
# produced thousands of back-to-back 429s in the logs. Once we see that
# specific signal, stop calling the LLM entirely until the reported reset
# time and go straight to the labeled fallback.
_quota_exhausted_until: float | None = None  # epoch seconds, or None if not tripped


def _is_daily_quota_exhausted(exc: Exception) -> tuple[bool, float | None]:
    """Detect OpenRouter's daily-quota-exhausted 429 and extract its reset time."""
    msg = str(exc)
    if "free-models-per-day" not in msg and "per-day" not in msg.lower():
        return False, None
    reset_at = None
    try:
        response = getattr(exc, "response", None)
        headers = getattr(response, "headers", None) or {}
        reset_ms = headers.get("X-RateLimit-Reset")
        if reset_ms:
            reset_at = float(reset_ms) / 1000.0
    except Exception:
        pass
    return True, reset_at


def _is_transient_error(exc: Exception) -> bool:
    """Errors worth a bounded retry: everything except confirmed daily-quota
    exhaustion (which retrying cannot fix) and non-retryable client errors.

    This CrewAI version routes "openrouter/..." models through its native
    OpenAICompatibleCompletion class rather than calling litellm directly
    (see openrouter_llm above), so exceptions raised here are raw `openai.*`
    types, not `litellm.exceptions.*` — checking against the litellm
    hierarchy would never match anything and silently disable retries
    entirely. Check both hierarchies so this keeps working if that routing
    ever changes back to a litellm.completion() call path.
    """
    is_daily, _ = _is_daily_quota_exhausted(exc)
    if is_daily:
        return False
    transient_types = (
        # Raw OpenAI SDK exceptions — what's actually raised on the native path.
        openai.RateLimitError,
        openai.APIConnectionError,
        openai.APITimeoutError,
        openai.InternalServerError,
        # litellm's normalized equivalents, in case the call path routes
        # through litellm.completion() instead (e.g. a future CrewAI version,
        # or a non-openrouter model).
        litellm.exceptions.RateLimitError,
        litellm.exceptions.APIConnectionError,
        litellm.exceptions.Timeout,
        litellm.exceptions.ServiceUnavailableError,
        litellm.exceptions.InternalServerError,
    )
    return isinstance(exc, transient_types)


# --- Agent Definition ---
#
# A fresh Agent/Task/Crew is built per deliberation rather than as module-
# level singletons. CrewAI's executor holds per-call state on the Agent
# instance itself, so two deliberations running concurrently against the
# *same* Agent object collide with "Executor is already running" — this
# happened in practice as soon as more than one WebSocket connection (e.g.
# two browser tabs) triggered a tripwire around the same time.

def _build_crew(context: str) -> Crew:
    """Build a fresh single-agent crew for one deliberation.

    The agent is briefed to reason through race-engineering, tyre, and
    strategy perspectives internally before answering — one LLM call
    produces the same kind of considered verdict the old 3-agent sequential
    chain did, at a third of the quota cost.
    """
    strategist = Agent(
        role="F1 Race Strategist",
        goal="Analyze real-time telemetry anomalies and recommend optimal race strategy decisions",
        backstory=(
            "You are a senior F1 strategist with 15 years of experience, sitting on the "
            "pit wall. Before calling a strategy, you privately run through three lenses: "
            "(1) as a race engineer, read the throttle/brake/RPM pattern for mechanical or "
            "driver-input concerns; (2) as a tyre performance engineer, read the wear and "
            "compound data for degradation; (3) as strategist, weigh both into a single call "
            "in terms of undercuts, overcuts, and safety car windows. "
            "You only output the final strategist call, not your intermediate reasoning."
        ),
        llm=openrouter_llm,
        verbose=False,
        allow_delegation=False,
        # Agent.max_retry_limit defaults to 2 (3 attempts total) and is
        # separate from the LLM client's own retry setting — it's CrewAI's
        # task-execution-level retry, which fires again here on any non-
        # litellm-module exception (the OpenAI SDK exceptions this native
        # OpenRouter path raises qualify). Left at the default, every
        # deliberate() call would silently retry 3x internally before our
        # own circuit breaker / backoff loop ever saw the failure. Set to 0
        # so retry policy lives in exactly one place: deliberate() below.
        #
        # Deliberately NOT setting planning_config / planning=True / reasoning
        # =True here: those pull in an entirely separate flow-based executor
        # with its own multi-step "reasoning -> fallback text parsing ->
        # replan" pipeline, each step its own LLM call with its own retries —
        # tried it, and it made things worse (9 requests for one deliberation
        # instead of 3). Agent/Task's classic single-shot executor plus
        # max_retry_limit=0 is the only combination that yields exactly one
        # LLM call per deliberate() invocation.
        max_retry_limit=0,
    )

    strategy_task = Task(
        description=(
            "Telemetry snapshot triggered a tripwire:\n\n"
            f"{context}\n\n"
            "Weigh car health, driver inputs, and tyre state, then issue the final "
            "strategy call for this lap. Be concrete and racing-accurate: name the "
            "action (box now / stay out / monitor) and, if relevant, the target "
            "compound or lap window. 1-2 sentences, no hedging, no intermediate reasoning."
        ),
        expected_output="A single concrete, actionable strategy recommendation (1-2 sentences).",
        agent=strategist,
    )

    return Crew(
        agents=[strategist],
        tasks=[strategy_task],
        process=Process.sequential,
        verbose=False,
    )


# --- Async Wrapper ---

MAX_RETRIES = 2  # bounded: this runs inside a 45s deliberation timeout anyway
BASE_BACKOFF_SECONDS = 1.5


async def deliberate(state: dict, alerts: list[dict]) -> dict:
    """Run CrewAI deliberation on a telemetry anomaly. Returns a verdict payload."""
    global _quota_exhausted_until

    telemetry = state.get("telemetry", {})
    context = json.dumps({
        "driver": telemetry.get("driver"),
        "driver_code": telemetry.get("code"),
        "driver_name": telemetry.get("name"),
        "team": telemetry.get("team"),
        "lap": telemetry.get("lap", "?"),
        "tick": telemetry.get("tick", "?"),
        "speed": telemetry.get("speed"),
        "rpm": telemetry.get("rpm"),
        "throttle": telemetry.get("throttle"),
        "brake": telemetry.get("brake"),
        "tyre_wear": telemetry.get("tyre_wear"),
        "tyre_type": telemetry.get("tyre_type", "medium"),
        "drs": telemetry.get("drs"),
        "race_position": telemetry.get("race_position"),
        "alerts": alerts,
    }, indent=2)

    if not HAS_LLM_KEY:
        return _fallback_verdict(telemetry, alerts, reason="No OPENROUTER_API_KEY set")

    now = time.time()
    if _quota_exhausted_until is not None:
        if now < _quota_exhausted_until:
            remaining_min = int((_quota_exhausted_until - now) / 60)
            return _fallback_verdict(
                telemetry, alerts,
                reason=f"OpenRouter free-tier daily quota exhausted, resets in ~{remaining_min}m"
            )
        # Reset window has passed — clear the breaker and try again for real.
        _quota_exhausted_until = None

    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            crew = _build_crew(context)
            # litellm's default request_timeout is effectively unbounded (6000s),
            # so a stalled OpenRouter request would otherwise hang this coroutine
            # forever — and since main.py's dispatcher only releases its
            # in-flight slot when this coroutine returns, one hung call would
            # permanently jam every subsequent tripwire into "skipped". Bound it
            # here so a stall degrades to a labeled fallback instead.
            result = await asyncio.wait_for(asyncio.to_thread(crew.kickoff), timeout=45.0)
            verdict_text = str(result).strip() if result else None
            if not verdict_text:
                return _fallback_verdict(telemetry, alerts, reason="Empty crew result")
            return {
                "type": "AI_STRATEGY_OVERLAY",
                "content": verdict_text,
                "alerts": alerts,
                "lap": telemetry.get("lap"),
                "tick": telemetry.get("tick"),
                "driver": telemetry.get("driver"),
                "source": "crewai",
            }
        except asyncio.TimeoutError:
            return _fallback_verdict(telemetry, alerts, reason="CrewAI/OpenRouter call timed out after 45s")
        except Exception as e:
            last_error = e
            is_daily, reset_at = _is_daily_quota_exhausted(e)
            if is_daily:
                # Trip the breaker so every subsequent tripwire (across all
                # drivers/connections) skips straight to fallback instead of
                # retrying against a quota that's guaranteed to still be zero.
                _quota_exhausted_until = reset_at or (now + 3600)
                return _fallback_verdict(
                    telemetry, alerts,
                    reason="OpenRouter free-tier daily quota exhausted for today"
                )
            if not _is_transient_error(e) or attempt >= MAX_RETRIES:
                break
            # Bounded exponential backoff with jitter for genuinely transient
            # errors only (connection issues, per-minute rate limits, 5xxs).
            delay = BASE_BACKOFF_SECONDS * (2 ** attempt) + random.uniform(0, 0.5)
            await asyncio.sleep(delay)

    return _fallback_verdict(telemetry, alerts, reason=f"CrewAI/OpenRouter error: {str(last_error)[:160]}")


def _fallback_verdict(telemetry: dict, alerts: list[dict], reason: str) -> dict:
    """Deterministic, clearly-labeled fallback when the LLM path can't run.

    Never silently pretends to be an LLM verdict — content and `source`
    both make clear this is a rule-based fallback, not a model output.
    """
    return {
        "type": "AI_STRATEGY_OVERLAY",
        "content": (
            f"[FALLBACK — {reason}] "
            f"Tripwire triggered on Lap {telemetry.get('lap', '?')}: "
            f"{', '.join(a['type'] for a in alerts)}. "
            f"Rule-based suggestion: monitor and box for Hard tyres if the pattern persists."
        ),
        "alerts": alerts,
        "lap": telemetry.get("lap"),
        "tick": telemetry.get("tick"),
        "driver": telemetry.get("driver"),
        "source": "fallback",
    }

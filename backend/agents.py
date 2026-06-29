"""CrewAI multi-agent deliberation powered by NVIDIA NIM API.

Agents: Strategist, Tyre Analyst, Race Engineer
LLM: NVIDIA NIM (OpenAI-compatible endpoint)
"""

import os
import asyncio
import json
from dotenv import load_dotenv

load_dotenv()

NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY", "")
NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
NIM_MODEL = "meta/llama-3.3-70b-instruct"


# --- CrewAI Setup ---

from crewai import Agent, Task, Crew, Process, LLM

nim_llm = LLM(
    model=f"nvidia_nim/{NIM_MODEL}",
    api_key=NIM_API_KEY,
    base_url=NIM_BASE_URL,
)


# --- Agent Definitions ---

strategist = Agent(
    role="F1 Race Strategist",
    goal="Analyze real-time telemetry anomalies and recommend optimal race strategy decisions",
    backstory=(
        "You are a senior F1 strategist with 15 years of experience. "
        "You specialize in tire strategy, pit stop optimization, and reading race dynamics. "
        "You think in terms of undercuts, overcuts, and safety car windows."
    ),
    llm=nim_llm,
    verbose=False,
    allow_delegation=False,
)

tyre_analyst = Agent(
    role="Tyre Performance Engineer",
    goal="Diagnose tyre degradation patterns and recommend compound changes",
    backstory=(
        "You are a Pirelli tyre specialist embedded in the garage. "
        "You read wear curves, track temperature, and know exactly how many laps "
        "each compound can deliver at race pace."
    ),
    llm=nim_llm,
    verbose=False,
    allow_delegation=False,
)

race_engineer = Agent(
    role="Race Engineer",
    goal="Assess car health, driver inputs, and mechanical reliability from telemetry",
    backstory=(
        "You sit on the pit wall with the driver's race engineer. "
        "You interpret throttle traces, brake temps, and RPM patterns to detect "
        "mechanical issues before they become terminal."
    ),
    llm=nim_llm,
    verbose=False,
    allow_delegation=False,
)


# --- Crew ---

race_control_crew = Crew(
    agents=[strategist, tyre_analyst, race_engineer],
    process=Process.sequential,
    verbose=False,
)


# --- Async Wrapper ---

async def deliberate(state: dict, alerts: list[dict]) -> dict:
    """Run multi-agent deliberation on a telemetry anomaly. Returns a verdict payload."""

    telemetry = state.get("telemetry", {})
    context = json.dumps({
        "lap": telemetry.get("lap", "?"),
        "tick": telemetry.get("tick", "?"),
        "speed": telemetry.get("speed"),
        "rpm": telemetry.get("rpm"),
        "throttle": telemetry.get("throttle"),
        "brake": telemetry.get("brake"),
        "tyre_wear": telemetry.get("tyre_wear"),
        "tyre_type": telemetry.get("tyre_type", "medium"),
        "drs": telemetry.get("drs"),
        "alerts": alerts,
    }, indent=2)

    task_description = (
        "Analyze this telemetry snapshot and its triggered alerts. "
        "Collaborate to produce a concise, actionable strategy recommendation. "
        "The recommendation should be 1-2 sentences, specific, and racing-accurate.\n\n"
        f"TELEMETRY CONTEXT:\n{context}\n\n"
        "Output format: a single strategy verdict as plain text."
    )

    task = Task(
        description=task_description,
        expected_output="A single concise strategy recommendation (1-2 sentences).",
        agent=strategist,
    )

    try:
        result = await asyncio.to_thread(race_control_crew.kickoff, inputs={"task": task_description})
        verdict_text = str(result) if result else f"CrewAI deliberation complete on Lap {telemetry.get('lap', '?')}. Alerts: {', '.join(a['type'] for a in alerts)}."
    except Exception as e:
        verdict_text = (
            f"STRATEGY OVERLAY (Lap {telemetry.get('lap', '?')}): "
            f"Tripwire triggered — {', '.join(a['type'] for a in alerts)}. "
            f"CrewAI deliberation skipped (API error: {str(e)[:100]})."
        )

    return {
        "type": "AI_STRATEGY_OVERLAY",
        "content": verdict_text,
        "alerts": alerts,
        "lap": telemetry.get("lap"),
        "tick": telemetry.get("tick"),
    }
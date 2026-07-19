import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function DriverDetail() {
  const { frames, selectedDriverId, overlays } = useRaceWebSocket();

  // Map driver IDs to names (for the 5 drivers in the simulation)
  const driverNames: Record<number | string, string> = {
    44: "Lewis Hamilton",
    77: "Valtteri Bottas",
    33: "Max Verstappen",
    11: "Sergio Pérez",
    55: "Carlos Sainz",
  };

  // Find selected driver frame
  const frame = frames.find((f) => f.driver == selectedDriverId);
  // For overlay, just show latest overlay (could filter by driver if we stored driver in overlay)
  const latestOverlay = overlays[overlays.length - 1];

  if (!frame) {
    return (
      <div className="p-2 text-zinc-400 text-center">
        Click on a driver in the track to see their details here
      </div>
    );
  }

  const driverName = driverNames[frame.driver] ?? `Driver ${frame.driver}`;

  return (
    <div className="bg-zinc-800/50 backdrop-blur-sm p-4 rounded-lg border border-zinc-700 text-zinc-200 text-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="font-medium">
            {driverName} (<span className="font-mono">#{frame.driver}</span>)
          </div>
          <div className="text-xs text-zinc-400">
            Lap {frame.lap}
          </div>
        </div>
        <div className="text-xs text-zinc-400">
          #{frame.driver}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Position:</span>
          <span className="font-mono">
            {frame.position ? `P${frame.position.toFixed(2)}` : "?"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Speed:</span>
          <span className="font-mono">{frame.speed.toFixed(0)} km/h</span>
        </div>
        <div className="flex justify-between">
          <span>Throttle:</span>
          <span className="font-mono">
            {(frame.throttle * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span>Brake:</span>
          <span className="font-mono">
            {(frame.brake * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span>RPM:</span>
          <span className="font-mono">{frame.rpm.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Tyres:</span>
          <span className="font-mono">
            {frame.tyre_type.toUpperCase()}
            {(frame.tyre_wear * 100).toFixed(0)}% worn
          </span>
        </div>
        <div className="flex justify-between">
          <span>DRS:</span>
          <span className="font-mono">{frame.drs ? "OPEN" : "CLOSED"}</span>
        </div>
        {frame.compound && (
          <div className="flex justify-between">
            <span>Compound:</span>
            <span className="font-mono">{frame.compound}</span>
          </div>
        )}
      </div>

      {/* AI Overlay (if any) */}
      {latestOverlay && (
        <div className="mt-4 p-3 bg-purple-900/50 border border-purple-600 rounded text-purple-200 text-xs">
          <div className="flex items-center mb-1">
            <div className="w-3 h-3 bg-purple-400 rounded mr-2"></div>
            <span className="font-medium">AI Strategy (Lap {frame.lap}):</span>
          </div>
          <div className="whitespace-pre-wrap">{latestOverlay.content}</div>
        </div>
      )}
    </div>
  );
}
import { useRaceWebSocket } from "../hooks/useRaceWebSocket";

export default function DriverDetail() {
  const { frames, selectedDriverId, overlays } = useRaceWebSocket();

  // Find selected driver frame
  const frame = frames.find((f) => f.driver == selectedDriverId);
  // For overlay, just show latest overlay (could filter by driver if we stored driver in overlay)
  const latestOverlay = overlays[overlays.length - 1];

  if (!frame) {
    return <div className="p-2 text-zinc-400">Select a driver to see details</div>;
  }

  return (
    <div className="bg-zinc-800/50 backdrop-blur-sm p-3 rounded-lg border border-zinc-700 text-zinc-200 text-sm">
      <div className="font-medium mb-1">
        Driver {frame.driver} Details
      </div>
      <div className="space-y-2">
        <div>
          Lap: <span className="font-mono">{frame.lap}</span>
        </div>
        <div>
          Speed: <span className="font-mono">{frame.speed.toFixed(0)} km/h</span>
        </div>
        <div>
          Throttle: <span className="font-mono">
            {(frame.throttle * 100).toFixed(0)}%
          </span>
        </div>
        <div>
          Brake: <span className="font-mono">
            {(frame.brake * 100).toFixed(0)}%
          </span>
        </div>
        <div>
          RPM: <span className="font-mono">{frame.rpm.toLocaleString()}</span>
        </div>
        <div>
          Tyre Wear: <span className="font-mono">
            {(frame.tyre_wear * 100).toFixed(0)}%
          </span>
        </div>
        <div>
          Tyre Type: <span className="font-mono">{frame.tyre_type.toUpperCase()}</span>
        </div>
        <div>
          DRS: <span className="font-mono">{frame.drs ? "ON" : "OFF"}</span>
        </div>
        {frame.compound && (
          <div>
            Compound: <span className="font-mono">{frame.compound}</span>
          </div>
        )}
        {frame.position && (
          <div>
            Position: <span className="font-mono">P{frame.position}</span>
          </div>
        )}
      </div>

      {/* AI Overlay (if any) */}
      {latestOverlay && (
        <div className="mt-3 p-2 bg-purple-900/50 border border-purple-600 rounded text-purple-200 text-xs">
          <div className="font-medium">AI Strategy (Lap {frame.lap}):</div>
          <div>{latestOverlay.content}</div>
        </div>
      )}
    </div>
  );
}
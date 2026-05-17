import { AlertTriangle } from "lucide-react";

interface Props {
  error: string;
}

export function SetupBanner({ error }: Props) {
  if (!error) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-800">Data connection issue</p>
        <p className="text-xs text-amber-700 mt-0.5">
          There was an issue loading data. Try refreshing the page or contact your administrator if the problem persists.
        </p>
      </div>
    </div>
  );
}

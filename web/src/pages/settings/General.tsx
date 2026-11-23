import { Input } from "@/components/ui/input";
import { NAME_MAX, useUi } from "../../store/ui";

/** General settings: for now, the name Home greets you with. */
export function General() {
  const name = useUi((s) => s.name);
  const setName = useUi((s) => s.setName);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-2">
      <div className="min-w-0 flex-1">
        <label htmlFor="your-name" className="m-0 text-[14px] font-medium leading-5 text-ink">
          Your name
        </label>
        <p className="m-0 mt-0.5 text-[13px] text-ink-3">Home greets you with it. It stays on this machine.</p>
      </div>
      <Input
        id="your-name"
        value={name}
        maxLength={NAME_MAX}
        autoComplete="given-name"
        placeholder="Optional"
        onChange={(e) => setName(e.target.value)}
        className="h-[34px] w-56"
      />
    </div>
  );
}

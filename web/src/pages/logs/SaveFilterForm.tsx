import { useState, type FormEvent } from "react";

import { useSaveFilter } from "../../lib/log-api";
import { filterId, type LogQuery, type SavedLogFilter } from "../../lib/log-query";
import { small } from "./styles";

type Props = {
  workspace: string;
  stack: string;
  /** The filters to keep. */
  query: LogQuery;
  /** Called after the filter is saved, and when the person gives up. */
  onDone: () => void;
};

/** The filter a name and the current query make. Only a relative time range can be reused; a dragged-out stretch is not saved. */
function filterOf(name: string, stack: string, query: LogQuery): SavedLogFilter {
  const relative = query.since && /^\d+[smhd]$/.test(query.since);
  return {
    id: filterId(name),
    name: name.trim(),
    stack,
    services: query.services?.length ? query.services : undefined,
    levels: query.levels?.length ? query.levels : undefined,
    regex: query.regex,
    fields: query.fields?.length ? query.fields : undefined,
    since: relative ? query.since : undefined,
  };
}

/** Keeps the current filters with the workspace under a name. */
export function SaveFilterForm({ workspace, stack, query, onDone }: Readonly<Props>) {
  const save = useSaveFilter(workspace);
  const [name, setName] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(filterOf(name, stack, query), { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="filter-name">
        Name of the filter
      </label>
      <input
        id="filter-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, e.g. API errors"
        maxLength={60}
        autoComplete="off"
        className="h-[34px] w-64 max-w-full bg-fill px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill-hover"
      />
      <button type="submit" disabled={!name.trim() || save.isPending} className={small}>
        Save
      </button>
      <button type="button" onClick={onDone} className={small}>
        Cancel
      </button>
      {save.error && (
        <span role="alert" className="text-[13px] text-critical">
          {save.error.message}
        </span>
      )}
    </form>
  );
}

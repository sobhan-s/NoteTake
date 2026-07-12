import type { ListNotesQuery } from "@shared/core/types";

export interface SortControlProps {
  sort: ListNotesQuery["sort"];
  order: ListNotesQuery["order"];
  onChange: (next: {
    sort: ListNotesQuery["sort"];
    order: ListNotesQuery["order"];
  }) => void;
}

const SORT_OPTIONS: Array<{ value: ListNotesQuery["sort"]; label: string }> = [
  { value: "updatedAt", label: "Last updated" },
  { value: "createdAt", label: "Date created" },
  { value: "title", label: "Title" },
];

const SELECT_CLASSNAME =
  "h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2";

export function SortControl({ sort, order, onChange }: SortControlProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="notes-sort-field">
        Sort by
      </label>
      <select
        id="notes-sort-field"
        className={SELECT_CLASSNAME}
        value={sort}
        onChange={(event) =>
          onChange({
            sort: event.target.value as ListNotesQuery["sort"],
            order,
          })
        }
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="notes-sort-order">
        Sort direction
      </label>
      <select
        id="notes-sort-order"
        className={SELECT_CLASSNAME}
        value={order}
        onChange={(event) =>
          onChange({
            sort,
            order: event.target.value as ListNotesQuery["order"],
          })
        }
      >
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </select>
    </div>
  );
}

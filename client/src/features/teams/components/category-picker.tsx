import React from 'react';
import type { Category } from '../../orgs/org-api';

/** Tick one or more categories for a team (D-31). Each one shows on the complaint form. */
export const CategoryPicker: React.FC<{
  categories: Category[];
  value: string[];
  onChange: (ids: string[]) => void;
}> = ({ categories, value, onChange }) =>
  categories.length === 0 ? (
    <p className="text-xs text-slate-500">No categories yet (create them on the Categories page).</p>
  ) : (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
      {categories.map((c) => {
        const on = value.includes(c.id);
        return (
          <label
            key={c.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={on}
              onChange={(e) => onChange(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id))}
            />
            {c.name}
          </label>
        );
      })}
    </div>
  );

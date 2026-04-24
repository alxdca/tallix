CREATE TABLE entry_order_overrides (
  id serial PRIMARY KEY,
  year_id integer NOT NULL REFERENCES budget_years(id) ON DELETE CASCADE,
  entry_type varchar(20) NOT NULL,
  entry_id integer NOT NULL,
  sort_offset integer,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX entry_order_overrides_year_entry_unique
  ON entry_order_overrides (year_id, entry_type, entry_id);

CREATE INDEX entry_order_overrides_year_id_idx
  ON entry_order_overrides (year_id);

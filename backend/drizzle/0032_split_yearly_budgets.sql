-- Split legacy multi-year budgets into independently shareable yearly budgets.
--
-- Each budget keeps one year on the original budget ID: the current calendar
-- year when present, otherwise the newest year. Historical years move to new
-- budgets with the same owner, description, and copied shares. Per-budget
-- groups and assets are duplicated so moved items and asset values remain
-- isolated under their new budget.

CREATE TEMP TABLE _yearly_budget_split AS
SELECT
  by2.id AS old_year_id,
  by2.budget_id AS old_budget_id,
  by2.year,
  b.user_id,
  b.description,
  row_number() OVER (
    PARTITION BY by2.budget_id
    ORDER BY
      CASE WHEN by2.year = EXTRACT(YEAR FROM now())::integer THEN 0 ELSE 1 END,
      by2.year DESC
  ) AS keep_rank
FROM budget_years by2
INNER JOIN budgets b ON b.id = by2.budget_id
WHERE by2.budget_id IN (
  SELECT budget_id
  FROM budget_years
  GROUP BY budget_id
  HAVING COUNT(*) > 1
);

CREATE TEMP TABLE _yearly_budget_new_ids AS
SELECT
  old_year_id,
  old_budget_id,
  year,
  user_id,
  description,
  nextval(pg_get_serial_sequence('budgets', 'id'))::integer AS new_budget_id
FROM _yearly_budget_split
WHERE keep_rank > 1;

INSERT INTO budgets (id, user_id, description, start_year, created_at, updated_at)
SELECT
  new_budget_id,
  user_id,
  description,
  year,
  now(),
  now()
FROM _yearly_budget_new_ids;

INSERT INTO budget_shares (budget_id, user_id, role, created_at, updated_at)
SELECT
  n.new_budget_id,
  s.user_id,
  s.role,
  s.created_at,
  s.updated_at
FROM _yearly_budget_new_ids n
INNER JOIN budget_shares s ON s.budget_id = n.old_budget_id
ON CONFLICT (budget_id, user_id) DO NOTHING;

CREATE TEMP TABLE _yearly_budget_group_ids AS
SELECT
  n.old_year_id,
  n.new_budget_id,
  g.id AS old_group_id,
  nextval(pg_get_serial_sequence('budget_groups', 'id'))::integer AS new_group_id
FROM _yearly_budget_new_ids n
INNER JOIN budget_groups g ON g.budget_id = n.old_budget_id;

INSERT INTO budget_groups (id, budget_id, name, slug, type, sort_order, created_at, updated_at)
SELECT
  new_group_id,
  new_budget_id,
  g.name,
  g.slug,
  g.type,
  g.sort_order,
  g.created_at,
  g.updated_at
FROM _yearly_budget_group_ids m
INNER JOIN budget_groups g ON g.id = m.old_group_id;

UPDATE budget_items bi
SET group_id = m.new_group_id
FROM _yearly_budget_group_ids m
WHERE bi.year_id = m.old_year_id
  AND bi.group_id = m.old_group_id;

CREATE TEMP TABLE _yearly_budget_asset_ids AS
SELECT
  n.old_year_id,
  n.new_budget_id,
  a.id AS old_asset_id,
  nextval(pg_get_serial_sequence('assets', 'id'))::integer AS new_asset_id
FROM _yearly_budget_new_ids n
INNER JOIN assets a ON a.budget_id = n.old_budget_id;

INSERT INTO assets (
  id,
  budget_id,
  name,
  sort_order,
  is_system,
  is_debt,
  parent_asset_id,
  savings_type,
  created_at,
  updated_at
)
SELECT
  m.new_asset_id,
  m.new_budget_id,
  a.name,
  a.sort_order,
  a.is_system,
  a.is_debt,
  NULL,
  a.savings_type,
  a.created_at,
  a.updated_at
FROM _yearly_budget_asset_ids m
INNER JOIN assets a ON a.id = m.old_asset_id;

UPDATE assets cloned
SET parent_asset_id = parent_map.new_asset_id
FROM _yearly_budget_asset_ids child_map
INNER JOIN assets original ON original.id = child_map.old_asset_id
INNER JOIN _yearly_budget_asset_ids parent_map
  ON parent_map.old_year_id = child_map.old_year_id
  AND parent_map.old_asset_id = original.parent_asset_id
WHERE cloned.id = child_map.new_asset_id
  AND original.parent_asset_id IS NOT NULL;

UPDATE asset_values av
SET asset_id = m.new_asset_id
FROM _yearly_budget_asset_ids m
WHERE av.year_id = m.old_year_id
  AND av.asset_id = m.old_asset_id;

UPDATE budget_years by2
SET budget_id = n.new_budget_id,
    updated_at = now()
FROM _yearly_budget_new_ids n
WHERE by2.id = n.old_year_id;

UPDATE budgets b
SET start_year = kept.year,
    updated_at = now()
FROM _yearly_budget_split kept
WHERE b.id = kept.old_budget_id
  AND kept.keep_rank = 1;

UPDATE budgets b
SET start_year = only_year.year,
    updated_at = now()
FROM (
  SELECT budget_id, MIN(year) AS year
  FROM budget_years
  GROUP BY budget_id
  HAVING COUNT(*) = 1
) only_year
WHERE b.id = only_year.budget_id
  AND b.start_year <> only_year.year;

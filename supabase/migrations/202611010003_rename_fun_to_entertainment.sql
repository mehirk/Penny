-- Rename the default "Fun" spending category to "Entertainment" for people who already have it
-- (D-101). The id stays cat-fun, so budgets, bills, and transactions stay linked. Only rows
-- still named exactly "Fun" change; a name someone chose themselves is left alone.
update public.categories set name = 'Entertainment' where id = 'cat-fun' and name = 'Fun';
-- Transactions keep a copy of the category name for display.
update public.transactions set category = 'Entertainment' where category_id = 'cat-fun' and category = 'Fun';

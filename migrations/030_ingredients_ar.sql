-- Arabic ingredient lists — the QR menu carries official Arabic ingredients per dish,
-- so an Arabic guest asking "فيه ايه" gets the real Arabic list, not the English one.
alter table r_luciz.menu_items add column if not exists ingredients_ar text;
alter table r_justsmash.menu_items add column if not exists ingredients_ar text;
